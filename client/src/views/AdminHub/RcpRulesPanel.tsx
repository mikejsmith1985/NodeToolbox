// RcpRulesPanel.tsx — The Admin Hub switch for the temporary RCP production-change rules (GH #415).
//
// The restricted change period is not permanent, so its checklist can be turned off here; it also stops on its
// own after the period's last day, so nobody has to remember to switch it off.

import { useState } from 'react';

import { RCP_RULES_LAST_DAY, readRcpRulesEnabled, writeRcpRulesEnabled } from '../SnowHub/rcp/rcpApprovalEmail.ts';
import styles from './AdminHubView.module.css';

/** The RCP rules switch, with what it does and when it ends. */
export function RcpRulesPanel(): React.JSX.Element {
  const [isEnabled, setIsEnabled] = useState(() => readRcpRulesEnabled());

  const handleToggle = (nextIsEnabled: boolean) => {
    writeRcpRulesEnabled(nextIsEnabled);
    setIsEnabled(nextIsEnabled);
  };

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🗓️ RCP Production-Change Rules</h2>
      <p className={styles.adminDescription}>
        During the restricted change period every Production change needs an approved window (Friday–Sunday nights,
        never 5 AM–7 PM CT), the Director-level Service Owner as Requested By, the Director&apos;s email approval
        attached, a justification for changing now, and early submission for Moderate and High risk. When on, SNow
        Hub checks Production changes against these rules. The check stops by itself after {RCP_RULES_LAST_DAY}.
      </p>
      <label className={styles.fieldLabel}>
        <input checked={isEnabled} onChange={(changeEvent) => handleToggle(changeEvent.target.checked)} type="checkbox" />
        {' '}Check Production changes against the RCP rules
      </label>
    </section>
  );
}
