// IntakeReviewCells.tsx — The cells of one Epic Intake review row. Every value arrives pre-filled; each select changes
// only what the PO disagrees with, and every change is saved as the PO's own answer straight away.

import { useState } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import { buildManualDraft } from '../ai/intakeDraftRound.ts';
import {
  INTAKE_LABELS,
  ITEM_KINDS,
  ITEM_OWNERS,
  readItemDisplayTitle,
  readSettledValue,
  type EpicDraft,
  type EpicIntake,
  type IntakeItem,
  type IntakeLabel,
  type ItemKind,
  type ItemOwner,
} from '../epicIntakeModel.ts';
import { acceptDraft, answerDuplicate, answerKind, answerLabel, answerOwner, declineDraft, editDraft } from '../intakePoAnswers.ts';
import { formatStatedSizes, SUMMARY_ACTION_LABELS } from '../intakeSummary.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import { ITEM_KIND_LABELS, ITEM_OWNER_LABELS } from './intakeLabels.ts';
import {
  buildEpicChoiceOptions,
  isEnrollmentWork,
  isNewEpicRow,
  readEpicChoiceValue,
  toDuplicateVerdict,
  type ChoiceOption,
  type ReviewRow,
} from './intakeReviewRows.ts';

/** What every editable cell needs: the intake, the item, and how to save a change. */
export interface ReviewCellProps {
  intake: EpicIntake;
  item: IntakeItem;
  onChange: (intake: EpicIntake) => void;
  nowIso: () => string;
}

/** The dash shown where a column does not apply to the row. */
const NOT_APPLICABLE_TEXT = '—';

// ── A closed choice ──

interface ChoiceSelectProps {
  accessibleName: string;
  value: string;
  options: readonly ChoiceOption[];
  onChoose: (value: string) => void;
}

/** A select that saves as soon as the PO picks. "Choose…" is offered only while nothing is decided yet. */
function ChoiceSelect({ accessibleName, value, options, onChoose }: ChoiceSelectProps) {
  return (
    <select
      className={compositionStyles.selectInput}
      aria-label={accessibleName}
      value={value}
      onChange={(changeEvent) => { if (changeEvent.target.value !== '') onChoose(changeEvent.target.value); }}
    >
      {value === '' ? <option value="">Choose…</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

// ── Item ──

/** The item's title, its source lines on demand, its stated sizes, and why it deserves a look. */
export function ReviewItemCell({ intake, row }: { intake: EpicIntake; row: ReviewRow }) {
  const { item } = row;
  const itemLines = intake.lines.filter((line) => item.lineNumbers.includes(line.lineNumber));
  const statedSizes = formatStatedSizes(item.areaSizes);
  return (
    <td>
      <strong>{readItemDisplayTitle(item)}</strong>
      {statedSizes !== '' ? <div className={styles.intakeMuted}>{statedSizes}</div> : null}
      <details>
        <summary className={styles.intakeMuted}>{itemLines.length} line(s) from the notes</summary>
        <ul className={styles.intakeLineList}>
          {itemLines.map((line) => <li key={line.lineNumber}>[{line.lineNumber}] {line.text}</li>)}
        </ul>
      </details>
      {item.reviewFlag !== null ? <div className={styles.intakeReviewFlag}>⚠ {item.reviewFlag}</div> : null}
      {item.searchStatus === 'failed' ? <div className={styles.intakeReviewFlag}>Not checked — {item.searchFailureReason ?? 'the search failed'}</div> : null}
      {row.isAwaitingPoChoice ? <span className={`${styles.intakeBadge} ${styles.intakeBadge_open}`}>Needs your choice</span> : null}
    </td>
  );
}

// ── Kind and owner ──

const KIND_OPTIONS: ChoiceOption[] = ITEM_KINDS.map((kind) => ({ value: kind, label: ITEM_KIND_LABELS[kind] }));
const OWNER_OPTIONS: ChoiceOption[] = ITEM_OWNERS.map((owner) => ({ value: owner, label: ITEM_OWNER_LABELS[owner] }));

/** What the item is — the select that also turns an "Also in the notes" item back into work. */
export function ReviewKindCell({ intake, item, onChange, nowIso }: ReviewCellProps) {
  return (
    <td>
      <ChoiceSelect
        accessibleName={`Kind for "${readItemDisplayTitle(item)}"`}
        value={readSettledValue(item.decisions.kind) ?? ''}
        options={KIND_OPTIONS}
        onChoose={(value) => onChange(answerKind(intake, item.id, value as ItemKind, nowIso()))}
      />
    </td>
  );
}

/** Who owns the item. Shown only for work — nothing else has an owner. */
export function ReviewOwnerCell({ intake, item, onChange, nowIso }: ReviewCellProps) {
  if (item.decisions.owner.state === 'notApplicable') {
    return <td className={styles.intakeMuted}>{NOT_APPLICABLE_TEXT}</td>;
  }
  return (
    <td>
      <ChoiceSelect
        accessibleName={`Owner for "${readItemDisplayTitle(item)}"`}
        value={readSettledValue(item.decisions.owner) ?? ''}
        options={OWNER_OPTIONS}
        onChoose={(value) => onChange(answerOwner(intake, item.id, value as ItemOwner, nowIso()))}
      />
    </td>
  );
}

// ── DENP Epic and label ──

/** The existing Epic that covers the item, or a new one — only for Enrollment work that has been checked. */
export function ReviewEpicCell({ intake, item, onChange, nowIso }: ReviewCellProps) {
  if (!isEnrollmentWork(item)) {
    return <td className={styles.intakeMuted}>{NOT_APPLICABLE_TEXT}</td>;
  }
  if (item.searchStatus !== 'ok') {
    return <td className={styles.intakeMuted}>{item.searchStatus === 'failed' ? 'Not checked' : 'Not checked yet'}</td>;
  }
  return (
    <td>
      <ChoiceSelect
        accessibleName={`${intake.targetProjectKey} Epic for "${readItemDisplayTitle(item)}"`}
        value={readEpicChoiceValue(item)}
        options={buildEpicChoiceOptions(item)}
        onChoose={(value) => onChange(answerDuplicate(intake, item.id, toDuplicateVerdict(value), nowIso()))}
      />
    </td>
  );
}

const LABEL_OPTIONS: ChoiceOption[] = INTAKE_LABELS.map((label) => ({ value: label, label }));

/** Roadmap or Stability for a new Epic. */
export function ReviewLabelCell({ intake, item, onChange, nowIso }: ReviewCellProps) {
  if (!isNewEpicRow(item)) {
    return <td className={styles.intakeMuted}>{NOT_APPLICABLE_TEXT}</td>;
  }
  return (
    <td>
      <ChoiceSelect
        accessibleName={`Label for "${readItemDisplayTitle(item)}"`}
        value={readSettledValue(item.decisions.label) ?? ''}
        options={LABEL_OPTIONS}
        onChoose={(value) => onChange(answerLabel(intake, item.id, value as IntakeLabel, nowIso()))}
      />
    </td>
  );
}

// ── Draft ──

/** The draft Create will use: the written one, or the plain template built from the item's own lines. */
function readStartingDraft(intake: EpicIntake, item: IntakeItem): EpicDraft {
  return item.draft ?? buildManualDraft(item, intake.lines);
}

/** The summary and description, editable in place and saved as the PO's own when a field is left changed. */
function DraftEditor({ intake, item, onChange, nowIso }: ReviewCellProps) {
  const [draft, setDraft] = useState<EpicDraft>(() => readStartingDraft(intake, item));
  const title = readItemDisplayTitle(item);

  function saveIfChanged(): void {
    const startingDraft = readStartingDraft(intake, item);
    const isUnchanged = draft.summary === startingDraft.summary && draft.description === startingDraft.description;
    if (isUnchanged || draft.summary.trim() === '') return;
    onChange(editDraft(intake, item.id, { ...draft, summary: draft.summary.trim() }, nowIso()));
  }

  return (
    <details className={styles.intakeDraftEditor}>
      <summary>{draft.summary.trim() === '' ? 'Draft' : draft.summary}</summary>
      <input className={compositionStyles.textInput} aria-label={`Epic summary for "${title}"`} value={draft.summary}
        onChange={(changeEvent) => setDraft({ ...draft, summary: changeEvent.target.value })} onBlur={saveIfChanged} />
      <textarea className={compositionStyles.textAreaTall} aria-label={`Epic description for "${title}"`} value={draft.description}
        onChange={(changeEvent) => setDraft({ ...draft, description: changeEvent.target.value })} onBlur={saveIfChanged} />
      <p className={styles.intakeQuestionHint}>Sections marked ⚠ need business or technical validation before this Epic is relied on.</p>
      <button type="button" className={compositionStyles.secondaryButton} onClick={() => onChange(declineDraft(intake, item.id, nowIso()))}>
        Don&apos;t create
      </button>
    </details>
  );
}

/** A declined row, with the way back. */
function DeclinedDraft({ intake, item, onChange, nowIso }: ReviewCellProps) {
  return (
    <>
      <span className={styles.intakeMuted}>Won&apos;t be created </span>
      <button type="button" className={compositionStyles.secondaryButton}
        onClick={() => onChange(acceptDraft(intake, item.id, readStartingDraft(intake, item), nowIso()))}>
        Create it after all
      </button>
    </>
  );
}

/** The draft of a new Epic, or the way back when the PO said not to create it. */
export function ReviewDraftCell(props: ReviewCellProps) {
  const { item } = props;
  if (!isNewEpicRow(item)) {
    return <td className={styles.intakeMuted}>{NOT_APPLICABLE_TEXT}</td>;
  }
  if (readSettledValue(item.decisions.draftAccepted) === 'declined') {
    return <td><DeclinedDraft {...props} /></td>;
  }
  // A draft arriving later remounts the editor so it shows; the PO's own edits never trigger a remount.
  return <td><DraftEditor key={item.draft?.source ?? 'po'} {...props} /></td>;
}

// ── Outcome ──

/** The words for a row that is not final yet: it will be created, or what it is waiting on. */
function describePendingOutcome(row: ReviewRow): string {
  return row.bucket === 'create' ? 'Will be created' : row.summaryRow.reason;
}

/** What will happen, or has happened, to the item — read from the same summary row the Summary table shows. */
export function ReviewOutcomeCell({ row }: { row: ReviewRow }) {
  const { summaryRow } = row;
  if (summaryRow.jiraKey !== null && summaryRow.jiraUrl !== null) {
    return (
      <td>
        {SUMMARY_ACTION_LABELS[summaryRow.action]}{' '}
        <a href={summaryRow.jiraUrl} target="_blank" rel="noreferrer">{summaryRow.jiraKey}</a>
      </td>
    );
  }
  if (summaryRow.action === 'open') {
    return <td>{describePendingOutcome(row)}</td>;
  }
  const reasonSuffix = summaryRow.action === 'failed' ? ` — ${summaryRow.reason}` : '';
  return <td>{SUMMARY_ACTION_LABELS[summaryRow.action]}{reasonSuffix}</td>;
}
