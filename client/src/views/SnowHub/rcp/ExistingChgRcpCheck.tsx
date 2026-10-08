// ExistingChgRcpCheck.tsx — The RCP checklist for a change that already exists in ServiceNow (GH #415).
//
// Reads the change as ServiceNow holds it — so it checks what is SAVED — and judges it against the RCP rules.
// Shown only while the rules are switched on and the period has not ended, and only judged for Production
// (PRD / PFIX) changes; anything else gets one line saying the rules do not apply.

import { useEffect, useState } from 'react';

import styles from '../tabs/CreateChgTab.module.css';
import { readRcpRulesEnabled } from './rcpApprovalEmail.ts';
import { buildRcpApprovalEmailContext, evaluateRcpChecklist, fetchRcpChangeFacts, type RcpChangeFacts } from './rcpChangeFacts.ts';
import { RcpChecklist } from './RcpChecklist.tsx';
import { isRcpPeriodActive, readCentralTodayIso } from './rcpRules.ts';

interface ExistingChgRcpCheckProps {
  changeSysId: string;
  /** Today in Central Time; injected so the period's end is testable. */
  todayIso?: string;
}

/** Reads one existing change and shows its RCP checklist, or nothing while the rules are off. */
export function ExistingChgRcpCheck({ changeSysId, todayIso = readCentralTodayIso() }: ExistingChgRcpCheckProps) {
  const isActive = isRcpPeriodActive(readRcpRulesEnabled(), todayIso);
  const [facts, setFacts] = useState<RcpChangeFacts | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [readCount, setReadCount] = useState(0);

  // Reads the saved change on open and on every Re-check; a change switched away from mid-read is not shown.
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

  return (
    <section className={styles.section}>
      <div className={styles.clonePanel}>
        <h4 className={styles.panelSectionTitle}>RCP production-change rules</h4>
        <p className={styles.panelHint}>
          Checks what is saved in ServiceNow — save your edits, attach the Director&apos;s approval, then re-check.
        </p>
        {isLoading ? <p className={styles.panelHint}>Reading the change…</p> : null}
        {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
        {facts !== null && !facts.isProduction ? (
          <p className={styles.panelHint}>{`The RCP rules apply to Production changes only — this change is ${facts.environmentLabel || 'not marked Production'}.`}</p>
        ) : null}
        {facts !== null && facts.isProduction ? (
          <RcpChecklist emailContext={buildRcpApprovalEmailContext(facts)} results={evaluateRcpChecklist(facts, todayIso)} />
        ) : null}
        <div className={styles.buttonRow}>
          <button
            className={styles.secondaryButton}
            disabled={isLoading}
            onClick={() => {
              setIsLoading(true);
              setReadCount((currentCount) => currentCount + 1);
            }}
            type="button"
          >
            ↻ Re-check
          </button>
        </div>
      </div>
    </section>
  );
}
