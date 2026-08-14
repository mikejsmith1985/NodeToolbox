// PlacementTroubleshooter.tsx — "Why is this issue not on my board?", answered in place.
//
// The board excludes an issue at any of several independent steps, and from the outside every one of
// them looks the same: the issue simply is not there. Working that out previously meant describing the
// symptom to somebody who could read the code, and waiting. This asks Jira the same questions the board
// asks, in the same order, and shows what each one decided — so the answer arrives in one step.

import { useState } from 'react';

import { jiraGet } from '../../../../services/jiraApi.ts';
import styles from '../RollupBoardTab.module.css';
import { ExcludedIcon, IncludedIcon, NotApplicableIcon } from './BoardIcons.tsx';
import type { BoardMembershipReason } from '../boardMembershipReason.ts';
import {
  diagnosePlacement,
  summarizeDiagnosis,
  type DiagnosisStep,
  type PlacementDiagnosisInput,
} from '../placementDiagnosis.ts';

/** What the troubleshooter needs to ask the board's own questions. */
export interface PlacementTroubleshooterProps {
  piFieldId: string;
  featureLinkFieldId: string;
  selectedPiValue: string;
  carryOverPiValue: string;
  featureProjectKeys: readonly string[];
  /** The label marking this team's Features, so an unlabelled one is explained rather than mysterious. */
  teamFeatureLabel?: string;
  /**
   * Answers "why IS this here?" from what the board has already loaded.
   *
   * Asked FIRST, and it needs no Jira call: if the key is on the board, walking the exclusion steps
   * would be answering a question nobody asked. One input serves both directions, because from the
   * outside "why is this here" and "why is this missing" are the same moment of confusion.
   */
  explainLanePresence?: (issueKey: string) => BoardMembershipReason | null;
}

/** Marks each verdict so a scan down the list lands on the problem. */
const VERDICT_ICONS: Record<DiagnosisStep['verdict'], () => React.JSX.Element> = {
  included: IncludedIcon,
  excluded: ExcludedIcon,
  'not-applicable': NotApplicableIcon,
};

/** Reads the Feature key an issue points at, whether the field holds a key or an issue object. */
function readFeatureKey(issueFields: Record<string, unknown>, featureLinkFieldId: string): string | null {
  const rawValue = issueFields[featureLinkFieldId];
  if (typeof rawValue === 'string' && rawValue.trim() !== '') return rawValue.trim();
  if (rawValue && typeof rawValue === 'object') {
    const linkedIssue = rawValue as { key?: string };
    if (linkedIssue.key) return linkedIssue.key;
  }
  const parent = issueFields.parent as { key?: string } | undefined;
  return parent?.key ?? null;
}

/** The Board setup panel's "why is this missing" tool. */
export function PlacementTroubleshooter({
  piFieldId,
  featureLinkFieldId,
  selectedPiValue,
  carryOverPiValue,
  featureProjectKeys,
  teamFeatureLabel = '',
  explainLanePresence,
}: PlacementTroubleshooterProps) {
  const [issueKeyInput, setIssueKeyInput] = useState('');
  const [steps, setSteps] = useState<DiagnosisStep[] | null>(null);
  const [summary, setSummary] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [presenceReason, setPresenceReason] = useState<BoardMembershipReason | null>(null);

  /** Reads the issue and its Feature, then walks the board's decisions over them. */
  async function runDiagnosis(): Promise<void> {
    const issueKey = issueKeyInput.trim().toUpperCase();
    if (issueKey === '') return;

    setIsChecking(true);
    setSteps(null);
    setPresenceReason(null);

    // On the board already? Then the question is why it is HERE, and the answer costs no round trip.
    const lanePresence = explainLanePresence?.(issueKey) ?? null;
    if (lanePresence !== null) {
      setPresenceReason(lanePresence);
      setSummary(`${issueKey} IS on this board.`);
      setIsChecking(false);
      return;
    }

    try {
      const issue = await jiraGet<{ fields?: Record<string, unknown> }>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
      ).catch(() => null);

      const issueFields = issue?.fields ?? null;
      const featureKey = issueFields ? readFeatureKey(issueFields, featureLinkFieldId) : null;

      // The Feature is read separately because the carry-over sweep judges the FEATURE's PI and
      // status, not the issue's — the commonest reason a carried-over story does not arrive.
      const featureIssue = featureKey
        ? await jiraGet<{ fields?: Record<string, unknown> }>(
          `/rest/api/2/issue/${encodeURIComponent(featureKey)}`,
        ).catch(() => null)
        : null;

      const diagnosisInput: PlacementDiagnosisInput = {
        issueKey,
        issueFields,
        piFieldId,
        featureLinkFieldId,
        selectedPiValue,
        carryOverPiValue,
        featureProjectKeys,
        teamFeatureLabel,
        featureKey,
        featureFields: featureIssue?.fields ?? null,
      };

      const diagnosedSteps = diagnosePlacement(diagnosisInput);
      setSteps(diagnosedSteps);
      setSummary(summarizeDiagnosis(issueKey, diagnosedSteps));
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className={styles.panelCard} data-testid="rollup-placement-troubleshooter">
      <h4 className={styles.sectionTitle}>Why is an issue on — or missing from — this board?</h4>
      <p className={styles.fieldLabel}>
        Enter any issue or Feature key. If it is on the board you are told what put it there; if it is
        not, this asks Jira the same questions the board asks, in the same order, and shows what each
        one decided.
      </p>

      <div className={styles.editorRow}>
        <input
          aria-label="Issue key to check"
          className={styles.inputField}
          disabled={isChecking}
          onChange={(changeEvent) => setIssueKeyInput(changeEvent.target.value)}
          onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter') void runDiagnosis(); }}
          placeholder="e.g. DENP-1371"
          value={issueKeyInput}
        />
        <button
          className={styles.actionButton}
          disabled={isChecking || issueKeyInput.trim() === ''}
          onClick={() => void runDiagnosis()}
          type="button"
        >
          {isChecking ? 'Checking…' : 'Check'}
        </button>
      </div>

      {presenceReason !== null && (
        <div className={styles.confirmationText}>
          <p>{summary} {presenceReason.summary}</p>
          {presenceReason.howToRemove !== '' && <p>{presenceReason.howToRemove}</p>}
        </div>
      )}

      {steps !== null && (
        <>
          <p className={styles.confirmationText}>{summary}</p>
          <ul>
            {steps.map((step) => (
              <li className={styles.fieldLabel} key={step.question}>
                <strong>
                  {(() => {
                    const VerdictIcon = VERDICT_ICONS[step.verdict];
                    return <VerdictIcon />;
                  })()}
                  {' '}{step.question}
                </strong> {step.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
