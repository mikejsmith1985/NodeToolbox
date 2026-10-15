// ChangePlanPdfActions.tsx — Gets the change plan PDF that the RCP approval email says is attached (GH #441).
//
// Offers ServiceNow's own PDF of the change form first, and a print-ready plan built from the change and its
// tasks as the fallback (ServiceNow's form PDF leaves the tasks out). Shown only for a change that exists in
// ServiceNow — a change still being built has nothing to print yet.

import { useState } from 'react';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import styles from '../tabs/CreateChgTab.module.css';
import { buildChangePlanDocumentHtml, buildServiceNowChangePdfUrl, fetchChangePlan, openChangePlanForPrinting } from './changePlanDocument.ts';
import type { RcpChangeFacts } from './rcpChangeFacts.ts';

interface ChangePlanPdfActionsProps {
  facts: RcpChangeFacts;
}

const PRINT_HINT = 'In the print dialog choose "Save as PDF", then attach the file to the approval email.';
const POPUP_BLOCKED_MESSAGE = 'The pop-up was blocked — allow pop-ups for Toolbox and try again.';
const GENERATED_ON_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' };

/** The two ways to get the change plan PDF, beside the approval email. */
export function ChangePlanPdfActions({ facts }: ChangePlanPdfActionsProps) {
  const snowBaseUrl = useConnectionStore((state) => state.proxyStatus?.snow?.baseUrl ?? null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const serviceNowPdfUrl = buildServiceNowChangePdfUrl(snowBaseUrl, facts.changeSysId);

  const handlePrintPlan = async () => {
    setIsPreparing(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      const plan = await fetchChangePlan(facts);
      const generatedOnLabel = `${new Intl.DateTimeFormat('en-US', GENERATED_ON_FORMAT).format(new Date())} CT`;
      const wasOpened = openChangePlanForPrinting(buildChangePlanDocumentHtml(plan, generatedOnLabel));
      if (wasOpened) {
        setStatusMessage(PRINT_HINT);
      } else {
        setErrorMessage(POPUP_BLOCKED_MESSAGE);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <div className={styles.environmentCard}>
      <h5 className={styles.panelSectionTitle}>Change plan PDF for the approval email</h5>
      <p className={styles.panelHint}>
        The email asks the approver to review the attached PDF. ServiceNow&apos;s PDF holds the change form; the
        print-ready plan adds the change tasks and their windows.
      </p>
      <div className={styles.buttonRow}>
        {serviceNowPdfUrl !== null ? (
          <a className={styles.secondaryButton} href={serviceNowPdfUrl} rel="noreferrer" target="_blank">
            📄 Open ServiceNow PDF
          </a>
        ) : null}
        <button className={styles.secondaryButton} disabled={isPreparing} onClick={() => void handlePrintPlan()} type="button">
          {isPreparing ? 'Reading the plan…' : '🖨️ Print-ready plan (with tasks)'}
        </button>
      </div>
      {statusMessage ? <p className={styles.successText}>{statusMessage}</p> : null}
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
    </div>
  );
}
