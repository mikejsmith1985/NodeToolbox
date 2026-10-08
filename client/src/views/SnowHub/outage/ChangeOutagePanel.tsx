// ChangeOutagePanel.tsx — Shows a change's outage record on Modify's Review & Save, and creates a planned one.
//
// A Production change was rejected because it had no outage record. This panel makes the record visible next to
// the CTASKs and, when a Production change has none, creates the planned outage from the change's own CI and
// window in one click — then reads it back so what is shown is what ServiceNow holds.

import { useCallback, useEffect, useState } from 'react';

import { createPlannedOutage, fetchChangeOutages, type ChangeOutage, type PlannedOutageInput } from './changeOutageRecord.ts';
import styles from '../tabs/CreateChgTab.module.css';

interface ChangeOutagePanelProps {
  /** Production (PRD / PFIX) changes need an outage record; other changes only see what is linked. */
  isProduction: boolean;
  /** The change, its CI and its planned window — what a planned outage is created from. */
  outageInput: PlannedOutageInput;
}

/** The outage records linked to the change, and the one-click planned outage when a Production change has none. */
export function ChangeOutagePanel({ isProduction, outageInput }: ChangeOutagePanelProps) {
  const [outages, setOutages] = useState<ChangeOutage[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { changeSysId } = outageInput;

  const loadOutages = useCallback(async () => {
    try {
      setOutages(await fetchChangeOutages(changeSysId));
    } catch (loadError) {
      setErrorMessage(loadError instanceof Error ? `Could not read the outage records: ${loadError.message}` : 'Could not read the outage records.');
    }
  }, [changeSysId]);

  // The first read when the panel opens; a change switched away from mid-read is not written into this one.
  useEffect(() => {
    let isStale = false;
    fetchChangeOutages(changeSysId)
      .then((linkedOutages) => {
        if (!isStale) setOutages(linkedOutages);
      })
      .catch((loadError: unknown) => {
        if (!isStale) setErrorMessage(loadError instanceof Error ? `Could not read the outage records: ${loadError.message}` : 'Could not read the outage records.');
      });
    return () => {
      isStale = true;
    };
  }, [changeSysId]);

  const handleCreate = async () => {
    setIsCreating(true);
    setErrorMessage('');
    try {
      const outageNumber = await createPlannedOutage(outageInput);
      setStatusMessage(`Created ${outageNumber || 'the planned outage'} — linked to this change.`);
      await loadOutages();
    } catch (createError) {
      setErrorMessage(createError instanceof Error ? createError.message : 'ServiceNow did not create the outage record.');
    }
    setIsCreating(false);
  };

  const hasNoOutage = outages !== null && outages.length === 0;

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>Outage record</h4>
      {outages === null && errorMessage === '' ? <p className={styles.panelHint}>Reading the outage records…</p> : null}
      {outages !== null && outages.length > 0 ? (
        <ul className={styles.riskFindingList}>
          {outages.map((outage) => (
            <li className={styles.riskFindingItem} key={outage.sysId || outage.number}>
              {`${outage.number} · ${outage.typeLabel || 'type not set'} · ${outage.beginLabel || '?'} → ${outage.endLabel || '?'}`}
            </li>
          ))}
        </ul>
      ) : null}
      {hasNoOutage && isProduction ? (
        <>
          <p className={styles.errorText}>This Production change has no outage record — it will not be approved without one.</p>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} disabled={isCreating} onClick={() => void handleCreate()} type="button">
              {isCreating ? 'Creating…' : 'Create planned outage record'}
            </button>
          </div>
          <p className={styles.panelHint}>Uses the change&apos;s configuration item, short description and planned start and end.</p>
        </>
      ) : null}
      {hasNoOutage && !isProduction ? <p className={styles.panelHint}>No outage record — not required outside Production.</p> : null}
      {statusMessage ? <p className={styles.successText} role="status">{statusMessage}</p> : null}
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
    </div>
  );
}
