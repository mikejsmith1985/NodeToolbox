// IntakeNotesPanel.tsx — Where the PO brings the notes in: paste them (rich paste keeps bullets and tables), drop a PDF,
// an Outlook .msg or a spreadsheet, or fetch a Confluence page — the same readers Feature Composition uses.

import { useState, type ClipboardEvent } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import { readConfluenceSource, ConfluenceSourceError } from '../../sources/confluenceSource.ts';
import { readOutlookMessageSource } from '../../sources/outlookMessageSource.ts';
import { readPastedText } from '../../sources/pastedRichText.ts';
import { readPdfSource } from '../../sources/pdfSource.ts';
import { describeSourceTitle, mintSourceId, type ReferencedSource } from '../../sources/sourceModel.ts';
import { readWorkbookSource } from '../../sources/workbookSource.ts';
import styles from '../EpicIntakeWorkspace.module.css';

/** What the file picker accepts: PDFs, Outlook messages and spreadsheets. */
const INTAKE_FILE_ACCEPT = '.pdf,.msg,.xlsx,.xls,.csv';

interface IntakeNotesPanelProps {
  onStart: (sources: ReferencedSource[]) => void;
}

/** Reads one file into a source, choosing the reader by its extension (the Bulk Re-write router). */
async function readFileAsSource(file: File, alreadyAdded: readonly ReferencedSource[]): Promise<ReferencedSource> {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.pdf')) return readPdfSource(file, alreadyAdded);
  if (fileName.endsWith('.msg')) return readOutlookMessageSource(file, alreadyAdded);
  return readWorkbookSource(file, alreadyAdded);
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ConfluenceSourceError || error instanceof Error ? error.message : fallback;
}

/** The notes inputs, the list of what has been added, and the Start button. */
export default function IntakeNotesPanel({ onStart }: IntakeNotesPanelProps) {
  const [sources, setSources] = useState<ReferencedSource[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [confluenceUrl, setConfluenceUrl] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);

  /**
   * Keeps the paste's plain-text flavour whenever it has one. Unlike Feature Composition, the intake groups items by
   * their bullets, and the shared HTML reader folds a nested list item and all its sub-bullets into one line — the
   * plain text Outlook and Teams provide keeps "•" / "o" lines apart. HTML is read only when there is no plain text.
   */
  function handlePaste(pasteEvent: ClipboardEvent<HTMLTextAreaElement>): void {
    const plainFlavour = pasteEvent.clipboardData.getData('text/plain');
    const htmlFlavour = pasteEvent.clipboardData.getData('text/html');
    if (plainFlavour !== '' || !htmlFlavour.includes('<')) return;
    pasteEvent.preventDefault();
    setPastedText((current) => `${current}${readPastedText(htmlFlavour, plainFlavour)}`);
  }

  function handleAddPaste(): void {
    setSources((current) => [...current, { kind: 'paste', id: mintSourceId(current, 'paste'), label: 'Pasted notes', text: pastedText }]);
    setPastedText('');
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    setSourceError(null);
    for (const file of Array.from(files ?? [])) {
      try {
        const source = await readFileAsSource(file, sources);
        setSources((current) => [...current, source]);
      } catch (error) {
        setSourceError(describeError(error, `${file.name} could not be read.`));
      }
    }
  }

  async function handleAddConfluence(): Promise<void> {
    setSourceError(null);
    try {
      const source = await readConfluenceSource(confluenceUrl.trim(), sources, new Date().toISOString());
      setSources((current) => [...current, source]);
      setConfluenceUrl('');
    } catch (error) {
      setSourceError(describeError(error, 'That page could not be added.'));
    }
  }

  return (
    <section className={compositionStyles.panel} aria-label="Notes">
      <h3 className={compositionStyles.panelTitle}>Bring in the notes</h3>
      <p className={compositionStyles.panelSubtitle}>Paste meeting notes or a list, or add a file or page. Bullets are kept — they are how Toolbox groups the items.</p>
      <label className={compositionStyles.fieldLabel} htmlFor="intake-paste">Pasted notes</label>
      <textarea id="intake-paste" className={compositionStyles.textAreaTall} value={pastedText} onPaste={handlePaste}
        onChange={(changeEvent) => setPastedText(changeEvent.target.value)} />
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.secondaryButton} disabled={pastedText.trim() === ''} onClick={handleAddPaste}>Add pasted notes</button>
        <label className={compositionStyles.secondaryButton}>
          Add a file…
          <input type="file" multiple accept={INTAKE_FILE_ACCEPT} className={compositionStyles.hiddenInput} onChange={(changeEvent) => { void handleFiles(changeEvent.target.files); }} />
        </label>
        <input aria-label="Confluence page URL" className={compositionStyles.textInput} placeholder="Confluence page URL" value={confluenceUrl} onChange={(changeEvent) => setConfluenceUrl(changeEvent.target.value)} />
        <button type="button" className={compositionStyles.secondaryButton} disabled={confluenceUrl.trim() === ''} onClick={() => { void handleAddConfluence(); }}>Add page</button>
      </div>
      {sourceError ? <p className={compositionStyles.errorBanner}>{sourceError}</p> : null}
      {sources.length > 0 ? (
        <ul className={compositionStyles.sourceList} aria-label="Added notes">
          {sources.map((source) => (
            <li key={source.id} className={compositionStyles.sourceCard}>
              <span className={compositionStyles.sourceTitle}>{describeSourceTitle(source)}</span>
              <button type="button" className={compositionStyles.secondaryButton} onClick={() => setSources((current) => current.filter((candidate) => candidate.id !== source.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.primaryButton} disabled={sources.length === 0} onClick={() => onStart(sources)}>Start intake</button>
      </div>
    </section>
  );
}
