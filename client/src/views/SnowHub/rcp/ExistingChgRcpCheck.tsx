// ExistingChgRcpCheck.tsx — The RCP checklist for a change that already exists in ServiceNow, and its fixes (GH #415).
//
// Reads the change as ServiceNow holds it — so it checks what is SAVED — and judges it against the RCP rules.
// Three gaps can be fixed from here: the window (moved to the next approved night by exact date arithmetic),
// Requested By (set to the CI's owner) and the justification (rewritten by AI Assist). Each fix writes straight
// to the change, tells the Modify form so a later Save cannot undo it, and re-checks. The Director's approval
// email is the one thing left to the owner: AI Assist drafts it, the owner sends it and attaches the reply.
// Shown only while the rules are switched on and the period has not ended, and only judged for Production.

import { useEffect, useState } from 'react';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { SnowReference } from '../hooks/useCrgState.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from '../tabs/AiAssistPromptModal.tsx';
import styles from '../tabs/CreateChgTab.module.css';
import { readRcpRulesEnabled } from './rcpApprovalEmail.ts';
import {
  buildRcpJustificationPrompt,
  planRcpWindowFix,
  readRcpJustificationReply,
  saveRcpChangeFix,
  type RcpChangeFix,
} from './rcpChangeFixes.ts';
import { buildRcpApprovalEmailContext, evaluateRcpChecklist, fetchRcpChangeFacts, type RcpChangeFacts } from './rcpChangeFacts.ts';
import { RcpChecklist, type RcpFixAction } from './RcpChecklist.tsx';
import { describeCentralWindow, isRcpPeriodActive, readCentralTodayIso, type RcpCheckResult } from './rcpRules.ts';

/** What a saved fix changed, for the Modify form to mirror. */
export interface RcpFormUpdate {
  justification?: string;
  requestedBy?: SnowReference;
  plannedStartUtc?: string;
  plannedEndUtc?: string;
}

interface ExistingChgRcpCheckProps {
  changeSysId: string;
  /** Today in Central Time; injected so the period's end is testable. */
  todayIso?: string;
  /** Now, as an ISO instant; injected so the next approved window is testable. */
  nowUtc?: string;
  /** Mirrors a saved fix into the Modify form, so a later Save writes the fixed values rather than the old ones. */
  onFixSaved?: (formUpdate: RcpFormUpdate) => void;
}

/** True when a rule is not yet met. */
function isOpen(results: readonly RcpCheckResult[], ruleId: RcpCheckResult['ruleId']): boolean {
  return results.some((result) => result.ruleId === ruleId && result.status !== 'pass');
}

/** The fixes this change can take, keyed by the rule each fixes. */
function buildFixActions(
  facts: RcpChangeFacts,
  results: readonly RcpCheckResult[],
  nowUtc: string,
  handlers: { applyFix: (fix: RcpChangeFix, formUpdate: RcpFormUpdate) => void; openJustificationFix: () => void; isBusy: boolean; isAiAssistUnlocked: boolean },
): Partial<Record<RcpCheckResult['ruleId'], RcpFixAction>> {
  const fixActions: Partial<Record<RcpCheckResult['ruleId'], RcpFixAction>> = {};
  const windowPlan = planRcpWindowFix(facts, nowUtc);
  if (windowPlan !== null && (isOpen(results, 'window') || isOpen(results, 'leadTime'))) {
    fixActions[isOpen(results, 'window') ? 'window' : 'leadTime'] = {
      label: `Move to the next approved window (${describeCentralWindow(windowPlan.plannedStartUtc, windowPlan.plannedEndUtc)})`,
      onFix: () => handlers.applyFix(windowPlan, windowPlan),
      isDisabled: handlers.isBusy,
    };
  }
  const ciOwner = facts.ciOwner;
  if (ciOwner?.sysId && ciOwner.sysId !== facts.requestedBy.sysId && isOpen(results, 'director')) {
    fixActions.director = {
      label: `Set Requested By to ${ciOwner.displayName}`,
      onFix: () => handlers.applyFix({ requestedBySysId: ciOwner.sysId }, { requestedBy: ciOwner }),
      isDisabled: handlers.isBusy,
    };
  }
  if (handlers.isAiAssistUnlocked && isOpen(results, 'justification')) {
    fixActions.justification = { label: '✦ Fix the justification with AI Assist', onFix: handlers.openJustificationFix, isDisabled: handlers.isBusy };
  }
  return fixActions;
}

/** Reads one existing change, shows its RCP checklist with fixes, or nothing while the rules are off. */
export function ExistingChgRcpCheck({
  changeSysId,
  todayIso = readCentralTodayIso(),
  nowUtc = new Date().toISOString(),
  onFixSaved,
}: ExistingChgRcpCheckProps) {
  const isActive = isRcpPeriodActive(readRcpRulesEnabled(), todayIso);
  const isAiAssistUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);
  const [facts, setFacts] = useState<RcpChangeFacts | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);

  // Reads the saved change on open, on every Re-check and after every fix; a change switched away from mid-read is not shown.
  useEffect(() => {
    if (!isActive) return undefined;
    let isStale = false;
    fetchRcpChangeFacts(changeSysId)
      .then((loadedFacts) => {
        if (isStale) return;
        setFacts(loadedFacts);
        setErrorMessage('');
      })
      .catch((loadError: unknown) => {
        if (!isStale) setErrorMessage(loadError instanceof Error ? loadError.message : 'Could not read the change.');
      })
      .finally(() => {
        if (!isStale) setIsLoading(false);
      });
    return () => {
      isStale = true;
    };
  }, [changeSysId, isActive, readCount]);

  if (!isActive) {
    return null;
  }

  const reRead = () => {
    setIsLoading(true);
    setReadCount((currentCount) => currentCount + 1);
  };

  const applyFix = async (fix: RcpChangeFix, formUpdate: RcpFormUpdate) => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      await saveRcpChangeFix(changeSysId, fix);
      onFixSaved?.(formUpdate);
      setStatusMessage('Saved to ServiceNow — re-checking.');
      reRead();
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : 'ServiceNow did not accept the fix.');
    } finally {
      setIsSaving(false);
    }
  };

  const openJustificationFix = () => {
    if (facts === null) return;
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to rewrite the justification for the RCP, then paste the reply below — '
        + 'it is saved to the change and re-checked.',
      promptText: buildRcpJustificationPrompt(facts),
      applyButtonLabel: 'Save this justification',
      applyReply: (replyText) => {
        const justification = readRcpJustificationReply(replyText);
        if (justification === '') {
          return { statusMessage: 'No JUSTIFICATION: section was found in the pasted reply.', wasApplied: false };
        }
        void applyFix({ justification }, { justification });
        return { statusMessage: 'Justification saved to the change — close this to see the re-check.', wasApplied: true };
      },
    });
  };

  const results = facts !== null && facts.isProduction ? evaluateRcpChecklist(facts, todayIso) : [];
  return (
    <section className={styles.section}>
      <div className={styles.clonePanel}>
        <h4 className={styles.panelSectionTitle}>RCP production-change rules</h4>
        <p className={styles.panelHint}>
          Checks what is saved in ServiceNow. Fixes are written straight to the change. The Director&apos;s approval is
          yours to send — draft it below, then attach their reply in ServiceNow and re-check.
        </p>
        {isLoading ? <p className={styles.panelHint}>Reading the change…</p> : null}
        {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
        {statusMessage ? <p className={styles.successText}>{statusMessage}</p> : null}
        {facts !== null && !facts.isProduction ? (
          <p className={styles.panelHint}>{`The RCP rules apply to Production changes only — this change is ${facts.environmentLabel || 'not marked Production'}.`}</p>
        ) : null}
        {facts !== null && facts.isProduction ? (
          <RcpChecklist
            emailContext={buildRcpApprovalEmailContext(facts)}
            fixActions={buildFixActions(facts, results, nowUtc, {
              applyFix: (fix, formUpdate) => void applyFix(fix, formUpdate),
              openJustificationFix,
              isBusy: isSaving || isLoading,
              isAiAssistUnlocked,
            })}
            results={results}
          />
        ) : null}
        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} disabled={isLoading} onClick={reRead} type="button">
            ↻ Re-check
          </button>
        </div>
      </div>
      {promptSession !== null ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </section>
  );
}
