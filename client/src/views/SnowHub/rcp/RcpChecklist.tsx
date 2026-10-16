// RcpChecklist.tsx — Shows whether a Production change meets the RCP rules, and drafts the Director's approval email.
//
// Leads with how many of the five rules are met, then each rule with its verdict and the reason, so the owner
// sees at a glance what still stands between the change and approval. When AI Assist is unlocked it also drafts
// the RCP approval request email (Change Management's template) the Director must reply to — the one rule Toolbox
// cannot satisfy on its own. RcpEmailDraft holds that email until it has no gaps.

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import styles from '../tabs/CreateChgTab.module.css';
import type { RcpApprovalEmailContext } from './rcpApprovalEmail.ts';
import { RcpEmailDraft } from './RcpEmailDraft.tsx';
import type { RcpCheckResult, RcpCheckStatus } from './rcpRules.ts';

interface RcpChecklistProps {
  results: readonly RcpCheckResult[];
  /** The facts the approval email is written from; null hides the draft. */
  emailContext: RcpApprovalEmailContext | null;
  /** Reads the rest of the change for AI Assist when the email is drafted (Modify CHG only). */
  loadFullEmailContext?: () => Promise<RcpApprovalEmailContext>;
  /** A fix per rule, offered beside that rule while it is not met. */
  fixActions?: Partial<Record<RcpCheckResult['ruleId'], RcpFixAction>>;
}

/** One rule's fix: what the button says, and what it does. */
export interface RcpFixAction {
  label: string;
  onFix: () => void;
  isDisabled?: boolean;
}

const STATUS_ICONS: Readonly<Record<RcpCheckStatus, string>> = { pass: '✅', fail: '❌', check: '⚠️' };

/** The RCP checklist for one Production change. */
export function RcpChecklist({ results, emailContext, loadFullEmailContext, fixActions = {} }: RcpChecklistProps) {
  const isAiAssistUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);
  const metCount = results.filter((result) => result.status === 'pass').length;

  return (
    <div className={styles.riskCheckResult}>
      <p className={styles.riskCheckHeading}>{`🗓️ ${metCount} of ${results.length} RCP rules met`}</p>
      <ul className={styles.riskFindingList}>
        {results.map((result) => (
          <li className={styles.riskFindingItem} key={result.ruleId}>
            <strong className={styles.riskFindingField}>{`${STATUS_ICONS[result.status]} ${result.title}`}</strong>
            <span className={styles.riskFindingDetail}>{result.detail}</span>
            {result.status !== 'pass' && fixActions[result.ruleId] ? (
              <span>
                <button
                  className={styles.secondaryButton}
                  disabled={fixActions[result.ruleId]?.isDisabled}
                  onClick={fixActions[result.ruleId]?.onFix}
                  type="button"
                >
                  {fixActions[result.ruleId]?.label}
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {isAiAssistUnlocked && emailContext !== null ? <RcpEmailDraft emailContext={emailContext} loadFullEmailContext={loadFullEmailContext} /> : null}
    </div>
  );
}
