// RcpInFlightSweep.tsx — Checks every in-flight Production change of mine against the RCP rules at once (GH #415).
//
// Change Management asked that changes already in Assess, Authorize or Scheduled be brought up to the new rules
// before they are implemented. One click reads each of those changes and shows how many rules it meets and
// what is still open, with a button that opens the change in Modify to fix it.

import { useState } from 'react';

import styles from '../tabs/CreateChgTab.module.css';
import { readRcpRulesEnabled } from './rcpApprovalEmail.ts';
import { evaluateRcpChecklist, fetchMyInFlightProductionChanges, fetchRcpChangeFacts, type InFlightChange } from './rcpChangeFacts.ts';
import { isRcpPeriodActive, readCentralTodayIso, type RcpCheckResult } from './rcpRules.ts';

interface RcpInFlightSweepProps {
  /** Opens a change in Modify, by its number. */
  onOpenChange: (changeNumber: string) => void;
  /** Today in Central Time; injected so the period's end is testable. */
  todayIso?: string;
}

/** One swept change and its verdicts, or why it could not be read. */
interface SweptChange {
  change: InFlightChange;
  results: RcpCheckResult[];
  errorMessage: string;
}

/** Reads and judges one change; a change that cannot be read is reported rather than dropped. */
async function sweepChange(change: InFlightChange, todayIso: string): Promise<SweptChange> {
  try {
    return { change, results: evaluateRcpChecklist(await fetchRcpChangeFacts(change.changeSysId), todayIso), errorMessage: '' };
  } catch (sweepError) {
    return { change, results: [], errorMessage: sweepError instanceof Error ? sweepError.message : 'Could not read this change.' };
  }
}

/** One change's row: how many rules it meets and which are still open. */
function SweptChangeRow({ sweptChange, onOpenChange }: { sweptChange: SweptChange; onOpenChange: (changeNumber: string) => void }) {
  const openResults = sweptChange.results.filter((result) => result.status !== 'pass');
  return (
    <tr>
      <td>{sweptChange.change.changeNumber}</td>
      <td>{sweptChange.change.stateLabel}</td>
      <td>{sweptChange.errorMessage ? '—' : `${sweptChange.results.length - openResults.length} of ${sweptChange.results.length}`}</td>
      <td>{sweptChange.errorMessage || openResults.map((result) => result.title).join('; ') || 'Ready'}</td>
      <td>
        <button className={styles.linkButton} onClick={() => onOpenChange(sweptChange.change.changeNumber)} type="button">
          Open
        </button>
      </td>
    </tr>
  );
}

/** The sweep button and its results table; nothing while the RCP rules are off. */
export function RcpInFlightSweep({ onOpenChange, todayIso = readCentralTodayIso() }: RcpInFlightSweepProps) {
  const [sweptChanges, setSweptChanges] = useState<SweptChange[] | null>(null);
  const [isSweeping, setIsSweeping] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isRcpPeriodActive(readRcpRulesEnabled(), todayIso)) {
    return null;
  }

  const handleSweep = async () => {
    setIsSweeping(true);
    setErrorMessage('');
    try {
      const inFlightChanges = await fetchMyInFlightProductionChanges();
      setSweptChanges(await Promise.all(inFlightChanges.map((change) => sweepChange(change, todayIso))));
    } catch (sweepError) {
      setErrorMessage(sweepError instanceof Error ? sweepError.message : 'Could not list your changes.');
    } finally {
      setIsSweeping(false);
    }
  };

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>RCP: in-flight Production changes</h4>
      <p className={styles.panelHint}>Changes already in Assess, Authorize or Scheduled must meet the RCP rules before they are implemented.</p>
      <div className={styles.buttonRow}>
        <button className={styles.secondaryButton} disabled={isSweeping} onClick={() => void handleSweep()} type="button">
          {isSweeping ? 'Checking…' : '🗓️ Check my in-flight Production changes'}
        </button>
      </div>
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
      {sweptChanges !== null && sweptChanges.length === 0 ? (
        <p className={styles.panelHint}>No Production changes of yours are in Assess, Authorize or Scheduled.</p>
      ) : null}
      {sweptChanges !== null && sweptChanges.length > 0 ? (
        <table>
          <thead><tr><th>Change</th><th>State</th><th>Rules met</th><th>Still open</th><th /></tr></thead>
          <tbody>
            {sweptChanges.map((sweptChange) => (
              <SweptChangeRow key={sweptChange.change.changeSysId} onOpenChange={onOpenChange} sweptChange={sweptChange} />
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
