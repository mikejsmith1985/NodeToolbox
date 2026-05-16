// CrgSubmissionDebugSection.tsx — Displays the most recent CRG submission debug data in Admin Hub.

import { useCrgSubmissionDebugStore } from '../../hooks/useCrgSubmissionDebugStore.ts'
import styles from './AdminHubView.module.css'

/**
 * CRG Submission Debug section — displays the most recent CRG create/update submission
 * including request payload, SNow response, verification record, and any field mismatches.
 * This allows admins to diagnose field mapping and submission issues without cluttering
 * the CRG wizard UI.
 */
export function CrgSubmissionDebugSection() {
  const lastSubmissionDebug = useCrgSubmissionDebugStore((state) => state.lastSubmissionDebug)

  if (!lastSubmissionDebug) {
    return (
      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>📋 CRG Submission Debug</h2>
        <p className={styles.adminDescription}>
          No CRG submissions yet. Create or update a CHG in the SNow Hub CRG wizard to see diagnostics here.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>📋 CRG Submission Debug</h2>
      <p className={styles.panelHint}>
        Operation: {lastSubmissionDebug.operation.toUpperCase()} {lastSubmissionDebug.targetChgNumber}
      </p>

      {lastSubmissionDebug.mismatchMessages.length > 0 ? (
        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Verification warnings</span>
          <ul className={styles.environmentList}>
            {lastSubmissionDebug.mismatchMessages.map((mismatchMessage) => (
              <li key={mismatchMessage}>{mismatchMessage}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="crg-request-payload">
          Request payload JSON
        </label>
        <textarea
          id="crg-request-payload"
          className={styles.releaseNotesTextarea}
          readOnly
          value={lastSubmissionDebug.requestPayloadJson}
          rows={4}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="crg-response">
          ServiceNow response JSON
        </label>
        <textarea
          id="crg-response"
          className={styles.releaseNotesTextarea}
          readOnly
          value={lastSubmissionDebug.operationResponseJson}
          rows={4}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="crg-verification">
          Post-update CHG record JSON
        </label>
        <textarea
          id="crg-verification"
          className={styles.releaseNotesTextarea}
          readOnly
          value={lastSubmissionDebug.verificationRecordJson}
          rows={4}
        />
      </div>
    </section>
  )
}
