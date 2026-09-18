// IntakeDraftReview.tsx — Each new Epic's draft, editable, with Accept and Decline. Nothing here writes to Jira: an
// accepted draft only becomes ready for the Create step (FR-022).

import { useState } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import { buildManualDraft } from '../ai/intakeDraftRound.ts';
import { readItemDisplayTitle, readSettledValue, type EpicDraft, type EpicIntake, type IntakeItem } from '../epicIntakeModel.ts';
import { acceptDraft, declineDraft, editDraft } from '../intakePoAnswers.ts';
import styles from '../EpicIntakeWorkspace.module.css';

interface IntakeDraftReviewProps {
  intake: EpicIntake;
  itemIds: readonly string[];
  onChange: (intake: EpicIntake) => void;
  nowIso: () => string;
}

interface DraftCardProps {
  item: IntakeItem;
  intake: EpicIntake;
  onChange: (intake: EpicIntake) => void;
  nowIso: () => string;
}

/** One draft: summary and description in place, saved as the PO's on blur, then accepted or declined. */
function DraftCard({ item, intake, onChange, nowIso }: DraftCardProps) {
  const [draft, setDraft] = useState<EpicDraft>(() => item.draft ?? buildManualDraft(item, intake.lines));
  const label = readSettledValue(item.decisions.label);
  const summaryId = `intake-draft-summary-${item.id}`;
  const descriptionId = `intake-draft-description-${item.id}`;
  const isSummaryBlank = draft.summary.trim() === '';
  const saveEdits = (): void => onChange(editDraft(intake, item.id, draft, nowIso()));
  return (
    <article className={styles.intakeDraftCard} aria-label={`Draft for ${readItemDisplayTitle(item)}`}>
      <label className={compositionStyles.fieldLabel} htmlFor={summaryId}>Summary{label ? ` · ${label}` : ''}</label>
      <input id={summaryId} className={compositionStyles.textInput} value={draft.summary}
        onChange={(changeEvent) => setDraft({ ...draft, summary: changeEvent.target.value })} onBlur={saveEdits} />
      <label className={compositionStyles.fieldLabel} htmlFor={descriptionId}>Description</label>
      <textarea id={descriptionId} className={compositionStyles.textAreaTall} value={draft.description}
        onChange={(changeEvent) => setDraft({ ...draft, description: changeEvent.target.value })} onBlur={saveEdits} />
      <p className={styles.intakeQuestionHint}>Sections marked ⚠ need business or technical validation before this Epic is relied on.</p>
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.primaryButton} disabled={isSummaryBlank}
          onClick={() => onChange(acceptDraft(intake, item.id, { ...draft, summary: draft.summary.trim() }, nowIso()))}>
          Accept
        </button>
        <button type="button" className={compositionStyles.secondaryButton} onClick={() => onChange(declineDraft(intake, item.id, nowIso()))}>
          Decline
        </button>
      </div>
    </article>
  );
}

/** The drafts waiting for the PO's review. */
export default function IntakeDraftReview({ intake, itemIds, onChange, nowIso }: IntakeDraftReviewProps) {
  const items = intake.items.filter((item) => itemIds.includes(item.id));
  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-label="Epic drafts">
      {items.map((item) => <DraftCard key={item.id} item={item} intake={intake} onChange={onChange} nowIso={nowIso} />)}
    </section>
  );
}
