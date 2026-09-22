// EpicIntakeWorkspace.tsx — The Epic Intake mode of Feature Composition: bring in notes, review one pre-filled table of
// every item, change only what you disagree with, then click Create — with the summary for the call always visible
// (spec 037, GH #387 feedback).
//
// The intake is saved after every change, so it can be resumed exactly where it was left. Where it stands — the
// step, whose turn it is, how much is open — is always re-derived from the answers by the engine, never stored.

import { useCallback, useMemo, useRef, useState } from 'react';

import { getIssueTypeFields } from '../../../services/jiraApi.ts';
import { useAiAssistStore } from '../../../store/aiAssistStore';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { canPersistDrafts } from '../drafts/splitDraftStorage.ts';
import compositionStyles from '../FeatureCompositionTab.module.css';
import type { ReferencedSource } from '../sources/sourceModel.ts';
import IntakeJourneyStrip from './components/IntakeJourneyStrip.tsx';
import IntakeNotesPanel from './components/IntakeNotesPanel.tsx';
import IntakeResumeBar from './components/IntakeResumeBar.tsx';
import IntakeReviewTable from './components/IntakeReviewTable.tsx';
import IntakeSummaryTable from './components/IntakeSummaryTable.tsx';
import IntakeTurnPanel, { type IntakeJiraDeps } from './components/IntakeTurnPanel.tsx';
import { createDuplicateSearchDeps } from './duplicateSearch.ts';
import { createEpicCreateDeps } from './epicCreate.ts';
import type { EpicIntake } from './epicIntakeModel.ts';
import { deleteEpicIntake, listEpicIntakes, loadEpicIntake, saveEpicIntake } from './epicIntakeStore.ts';
import { readIntakeNextStep } from './intakeChecklist.ts';
import { startEpicIntake } from './startIntake.ts';
import styles from './EpicIntakeWorkspace.module.css';

interface EpicIntakeWorkspaceProps {
  dashboardTeamProfileId: string;
  /** Jira calls, injectable for tests; the real ones are used when omitted. */
  jiraDeps?: IntakeJiraDeps;
  /** Clock, injectable for tests. */
  nowIso?: () => string;
}

function createDefaultJiraDeps(): IntakeJiraDeps {
  return { search: createDuplicateSearchDeps(), create: createEpicCreateDeps(), loadCreateFields: getIssueTypeFields };
}

function readCurrentIso(): string {
  return new Date().toISOString();
}

function mintIntakeId(): string {
  return `intake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The saved intakes for this team, re-read whenever something is saved or discarded. */
function useSavedIntakes(teamProfileId: string) {
  const [refreshCount, setRefreshCount] = useState(0);
  // refreshCount is read so the list is re-derived after every save or discard.
  const savedIntakes = useMemo(() => (refreshCount >= 0 ? listEpicIntakes(teamProfileId) : []), [teamProfileId, refreshCount]);
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);
  return { savedIntakes, refresh };
}

/**
 * What the last pasted answer could not be used for, read from the saved round history so it survives the step
 * moving on — and a resume — instead of vanishing with the paste box.
 */
function LastRoundNotice({ intake }: { intake: EpicIntake }) {
  const lastRound = intake.roundHistory[intake.roundHistory.length - 1];
  if (lastRound === undefined || lastRound.rejected.length === 0) {
    return null;
  }
  return (
    <div className={compositionStyles.warningBanner} role="status">
      <strong>{lastRound.acceptedCount} answer(s) used. Not used:</strong>
      <ul>
        {lastRound.rejected.map((rejection, index) => (
          <li key={`${rejection.itemId ?? 'reply'}-${index}`}>{rejection.itemId ? `${rejection.itemId}: ` : ''}{rejection.reason}</li>
        ))}
      </ul>
    </div>
  );
}

/** The whole Epic Intake mode. */
export default function EpicIntakeWorkspace({ dashboardTeamProfileId, jiraDeps, nowIso = readCurrentIso }: EpicIntakeWorkspaceProps) {
  const isAiUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);
  const jiraBaseUrl = useConnectionStore((storeState) => storeState.proxyStatus?.jira?.baseUrl ?? '');
  const resolvedJiraDeps = useMemo(() => jiraDeps ?? createDefaultJiraDeps(), [jiraDeps]);
  const [canSave] = useState(canPersistDrafts);
  const [intake, setIntake] = useState<EpicIntake | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const { savedIntakes, refresh } = useSavedIntakes(dashboardTeamProfileId);

  const updateIntake = useCallback((nextIntake: EpicIntake) => {
    setIntake(nextIntake);
    if (canSave && saveEpicIntake(nextIntake)) refresh();
  }, [canSave, refresh]);

  function handleStart(sources: ReferencedSource[]): void {
    updateIntake(startEpicIntake({ teamProfileId: dashboardTeamProfileId, sources, nowIso: nowIso(), mintId: mintIntakeId }));
  }

  function handleResume(intakeId: string): void {
    const loaded = loadEpicIntake(dashboardTeamProfileId, intakeId);
    if (loaded.status === 'loaded') {
      setLoadError(null);
      setIntake(loaded.intake);
      return;
    }
    setLoadError(loaded.status === 'missing' ? 'That intake is no longer saved.' : `That intake cannot be read: ${loaded.reason}`);
  }

  function handleDiscard(intakeId: string): void {
    deleteEpicIntake(dashboardTeamProfileId, intakeId);
    if (intake?.id === intakeId) setIntake(null);
    refresh();
  }

  const nextStep = intake === null ? null : readIntakeNextStep(intake, isAiUnlocked);
  return (
    <div className={styles.intakeWorkspace}>
      {!canSave ? <p className={compositionStyles.warningBanner}>This browser is not saving — finish in one sitting.</p> : null}
      <IntakeResumeBar savedIntakes={savedIntakes} activeIntakeId={intake?.id ?? null} onResume={handleResume} onDiscard={handleDiscard} onStartNew={() => setIntake(null)} />
      {loadError ? <p className={compositionStyles.errorBanner}>{loadError}</p> : null}
      {intake === null || nextStep === null ? <IntakeNotesPanel onStart={handleStart} /> : (
        <>
          {/* Pinned while the long review table scrolls underneath, so the next step never scrolls out of sight. */}
          <div className={styles.intakeStickyBar}>
            <IntakeJourneyStrip nextStep={nextStep} />
            {nextStep.turn !== 'done' ? (
              <button type="button" className={compositionStyles.secondaryButton} onClick={() => actionsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>
                Show what to do ↓
              </button>
            ) : null}
          </div>
          <LastRoundNotice intake={intake} />
          <div ref={actionsRef}>
            <IntakeTurnPanel intake={intake} isAiUnlocked={isAiUnlocked} onChange={updateIntake} jiraDeps={resolvedJiraDeps} nowIso={nowIso} />
          </div>
          <IntakeReviewTable intake={intake} isAiUnlocked={isAiUnlocked} jiraBaseUrl={jiraBaseUrl} onChange={updateIntake} nowIso={nowIso} />
          <IntakeSummaryTable intake={intake} jiraBaseUrl={jiraBaseUrl} />
        </>
      )}
    </div>
  );
}
