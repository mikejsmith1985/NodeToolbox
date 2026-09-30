// RiskCheckReviewPanel.tsx — The pasted risk-check review, laid out so a person can read it (GH #395).

import { countConfirmPlaceholders, parseRiskCheckReview, type RiskCheckFinding } from '../chgFormula/riskCheckReview.ts';
import type { ChgTextFieldKey } from '../chgFormula/formulaCard.ts';
import styles from './CreateChgTab.module.css';

interface RiskCheckReviewPanelProps {
  /** The review part of the pasted reply (the corrections section has already been applied and removed). */
  reviewText: string;
  /** The seven drafted fields as they stand now, to show which still need a person's [CONFIRM: …] answers. */
  fieldValues: Readonly<Record<ChgTextFieldKey, string>>;
}

/** "1 gap", "2 gaps": the summary line reads as a sentence, not a template. */
function pluralise(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** One gap or failed gate question: what is wrong, and the fix when the reviewer gave one. */
function FindingItem({ finding }: { finding: RiskCheckFinding }) {
  return (
    <li className={styles.riskFindingItem}>
      <strong className={styles.riskFindingField}>{finding.field}</strong>
      {finding.detail ? <span className={styles.riskFindingDetail}>{finding.detail}</span> : null}
      {finding.fix ? (
        <span className={styles.riskFindingFix}>
          <span className={styles.riskFindingFixLabel}>Fix: </span>
          <span>{finding.fix}</span>
        </span>
      ) : null}
    </li>
  );
}

/** A folded list of findings a reviewer does not need to act on (passes, not-applicable). */
function FoldedFindings({ title, findings }: { title: string; findings: RiskCheckFinding[] }) {
  if (findings.length === 0) {
    return null;
  }
  return (
    <details className={styles.riskFoldedFindings}>
      <summary>{`${title} (${findings.length})`}</summary>
      <ul className={styles.riskFindingList}>
        {findings.map((finding) => <FindingItem finding={finding} key={`${title}-${finding.field}`} />)}
      </ul>
    </details>
  );
}

/**
 * Leads with the verdict and the gaps, each with its fix, then the facts still waiting on a person, with
 * passes and not-applicable items folded away. A reply that is not in the checklist format is shown as
 * wrapped text rather than lost.
 */
export function RiskCheckReviewPanel({ reviewText, fieldValues }: RiskCheckReviewPanelProps) {
  const review = parseRiskCheckReview(reviewText);
  const gapFindings = review.findings.filter((finding) => finding.status === 'GAP');
  const failedGateFindings = review.findings.filter((finding) => finding.status === 'NO');
  const passedFindings = review.findings.filter((finding) => finding.status === 'PASS' || finding.status === 'YES');
  const notApplicableFindings = review.findings.filter((finding) => finding.status === 'N/A');
  const confirmCounts = countConfirmPlaceholders(fieldValues);

  return (
    <div className={styles.riskCheckResult}>
      <p className={styles.riskCheckHeading}>AI Assist risk review</p>
      {review.verdict ? (
        <p className={review.isReady ? styles.riskVerdictReady : styles.riskVerdictNotReady}>{review.verdict}</p>
      ) : null}
      {review.findings.length > 0 ? (
        <p className={styles.fieldLabel}>
          {`${pluralise(gapFindings.length, 'gap', 'gaps')} · ${passedFindings.filter((finding) => finding.status === 'PASS').length} passed · `
            + `${notApplicableFindings.length} not applicable`}
        </p>
      ) : null}
      {confirmCounts.length > 0 ? (
        <p className={styles.riskConfirmSummary}>
          {'Still to confirm: '}
          {confirmCounts.map((count) => `${count.fieldLabel} (${count.placeholderCount})`).join(', ')}
        </p>
      ) : null}
      {gapFindings.length > 0 ? (
        <ul aria-label="Gaps to fix" className={styles.riskFindingList}>
          {gapFindings.map((finding) => <FindingItem finding={finding} key={`gap-${finding.field}`} />)}
        </ul>
      ) : null}
      {failedGateFindings.length > 0 ? (
        <ul aria-label="Quality gate questions not met" className={styles.riskFindingList}>
          {failedGateFindings.map((finding) => <FindingItem finding={finding} key={`gate-${finding.field}`} />)}
        </ul>
      ) : null}
      <FoldedFindings findings={passedFindings} title="Passed" />
      <FoldedFindings findings={notApplicableFindings} title="Not applicable" />
      {review.unparsedLines.length > 0 ? (
        <p className={styles.riskCheckText}>{review.unparsedLines.join('\n')}</p>
      ) : null}
    </div>
  );
}
