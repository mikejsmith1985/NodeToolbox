// IntakeItemsTable.tsx — Every item in the intake with its lines, what Toolbox read from them, and each decision with a
// badge saying who settled it — a rule, a suggestion, or the PO — and why, on hover or keyboard focus.

import { formatStatedSizes } from '../intakeSummary.ts';
import {
  readItemDisplayTitle,
  type Decision,
  type DuplicateVerdict,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import { ITEM_KIND_LABELS, ITEM_OWNER_LABELS, SET_ASIDE_REASON_LABELS, SETTLED_BY_LABELS } from './intakeLabels.ts';

interface IntakeItemsTableProps {
  intake: EpicIntake;
}

interface DecisionCellProps<TValue> {
  decision: Decision<TValue>;
  formatValue: (value: TValue) => string;
}

/** One decision: its value and badge, "Open" while undecided, or a dash when it does not apply. */
function DecisionCell<TValue>({ decision, formatValue }: DecisionCellProps<TValue>) {
  if (decision.state === 'notApplicable') {
    return <span className={styles.intakeMuted} title={decision.reason}>—</span>;
  }
  if (decision.state === 'open') {
    const hint = decision.aiReason ?? decision.lastRejection ?? 'Not decided yet';
    return <span className={`${styles.intakeBadge} ${styles.intakeBadge_open}`} tabIndex={0} title={hint}>Open</span>;
  }
  return (
    <span>
      {formatValue(decision.value)}
      <span className={`${styles.intakeBadge} ${styles[`intakeBadge_${decision.settledBy}`]}`} tabIndex={0} title={decision.reason} aria-label={`${SETTLED_BY_LABELS[decision.settledBy]}: ${decision.reason}`}>
        {SETTLED_BY_LABELS[decision.settledBy]}
      </span>
    </span>
  );
}

function formatVerdict(verdict: DuplicateVerdict): string {
  if (verdict.verdict === 'existing') return verdict.key;
  return verdict.verdict === 'createNew' ? 'New Epic' : 'Not actionable';
}

function describeSearch(item: IntakeItem): string {
  if (item.searchStatus === 'failed') return `Not checked — ${item.searchFailureReason ?? 'the search failed'}`;
  if (item.searchStatus === 'notRun') return '';
  return item.candidates.length === 0 ? 'No open Epic found' : `${item.candidates.length} found: ${item.candidates.map((candidate) => candidate.key).join(', ')}`;
}

function ItemRow({ item, intake }: { item: IntakeItem; intake: EpicIntake }) {
  const itemLines = intake.lines.filter((line) => item.lineNumbers.includes(line.lineNumber));
  return (
    <tr>
      <td>
        <details>
          <summary>{readItemDisplayTitle(item)}</summary>
          <ul className={styles.intakeLineList}>
            {itemLines.map((line) => <li key={line.lineNumber}>[{line.lineNumber}] {line.text}</li>)}
          </ul>
        </details>
        {item.namedKeys.length > 0 ? <div className={styles.intakeMuted}>Named: {item.namedKeys.map((namedKey) => namedKey.key).join(', ')}</div> : null}
      </td>
      <td><DecisionCell decision={item.decisions.kind} formatValue={(kind) => ITEM_KIND_LABELS[kind]} /></td>
      <td><DecisionCell decision={item.decisions.owner} formatValue={(owner) => ITEM_OWNER_LABELS[owner]} /></td>
      <td>{formatStatedSizes(item.areaSizes)}</td>
      <td>
        <DecisionCell decision={item.decisions.duplicate} formatValue={formatVerdict} />
        <div className={styles.intakeMuted}>{describeSearch(item)}</div>
      </td>
      <td><DecisionCell decision={item.decisions.label} formatValue={(label) => label} /></td>
    </tr>
  );
}

/** The table of items, plus the lines set aside with their reasons, collapsed underneath. */
export default function IntakeItemsTable({ intake }: IntakeItemsTableProps) {
  return (
    <section className={styles.intakeTableScroller} aria-label="Items in the notes">
      <table className={styles.intakeTable}>
        <thead>
          <tr><th>Item</th><th>Kind</th><th>Owner</th><th>Stated sizes</th><th>DENP Epic</th><th>Label</th></tr>
        </thead>
        <tbody>
          {intake.items.map((item) => <ItemRow key={item.id} item={item} intake={intake} />)}
        </tbody>
      </table>
      {intake.setAsideLines.length > 0 ? (
        <details>
          <summary>{intake.setAsideLines.length} line(s) set aside</summary>
          <ul className={styles.intakeLineList}>
            {intake.setAsideLines.map((setAside) => (
              <li key={setAside.lineNumber}>
                [{setAside.lineNumber}] {intake.lines.find((line) => line.lineNumber === setAside.lineNumber)?.text} — {SET_ASIDE_REASON_LABELS[setAside.reason]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
