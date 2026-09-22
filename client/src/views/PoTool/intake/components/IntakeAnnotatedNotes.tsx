// IntakeAnnotatedNotes.tsx — "Notes with Epic keys": the PO's original notes with each item's Epic written back in
// beside it, and one Copy button, so the notes can be shared showing which Epic covers which scope (GH #387).

import { useState } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import type { EpicIntake } from '../epicIntakeModel.ts';
import { buildAnnotatedNotes } from '../intakeAnnotatedNotes.ts';
import { copyHtmlAndText } from '../intakeSummary.ts';
import styles from '../EpicIntakeWorkspace.module.css';

/** How long "✓ Copied" stays on the button. */
const COPY_CONFIRMATION_VISIBLE_MS = 2000;

interface IntakeAnnotatedNotesProps {
  intake: EpicIntake;
  jiraBaseUrl: string;
}

/** The notes with Epic keys, shown as they will paste, with a Copy button that keeps the keys as links. */
export default function IntakeAnnotatedNotes({ intake, jiraBaseUrl }: IntakeAnnotatedNotesProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const annotatedNotes = buildAnnotatedNotes(intake, jiraBaseUrl);

  async function handleCopy(): Promise<void> {
    try {
      await copyHtmlAndText(annotatedNotes.html, annotatedNotes.text);
      setCopyMessage('✓ Copied');
    } catch {
      setCopyMessage('Copy was blocked by the browser — select the text below and copy it instead.');
    }
    window.setTimeout(() => setCopyMessage(null), COPY_CONFIRMATION_VISIBLE_MS);
  }

  return (
    <section className={compositionStyles.panel} aria-label="Notes with Epic keys">
      <div className={styles.intakeActions}>
        <h3 className={compositionStyles.panelTitle}>Notes with Epic keys</h3>
        <button type="button" className={compositionStyles.primaryButton} onClick={() => { void handleCopy(); }}>📋 Copy notes</button>
        {copyMessage ? <span className={styles.intakeCount}>{copyMessage}</span> : null}
      </div>
      <p className={compositionStyles.panelSubtitle}>Your notes as you pasted them, with the Epic for each item written beside it — ready to share.</p>
      <textarea aria-label="Notes with Epic keys" className={compositionStyles.textAreaTall} readOnly value={annotatedNotes.text} />
    </section>
  );
}
