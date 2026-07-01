// SubmissionDropzone.tsx — Drag-and-drop (or click-to-pick) area that hands a dropped Excel/CSV
// file to the importer. Shows a clear, non-technical message when a file cannot be read (FR-6.1).

import { useRef, useState } from 'react';

import styles from '../JiraIntake.module.css';

interface SubmissionDropzoneProps {
  /** Called with the chosen file; the parent runs the parse/ingest and owns any error message. */
  onFile: (file: File) => void;
  /** Error text to show under the dropzone (e.g. an unreadable-file message), or null. */
  errorMessage: string | null;
}

/** A themed dropzone for the exported submissions file. */
export default function SubmissionDropzone({ onFile, errorMessage }: SubmissionDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragActive(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      onFile(droppedFile);
    }
  }

  function handlePicked(event: React.ChangeEvent<HTMLInputElement>): void {
    const pickedFile = event.target.files?.[0];
    if (pickedFile) {
      onFile(pickedFile);
    }
    // Reset so picking the same file again still fires a change event.
    event.target.value = '';
  }

  return (
    <div>
      <div
        aria-label="Drop the exported submissions file here"
        className={`${styles.dropzone} ${isDragActive ? styles.dropzoneActive : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragLeave={() => setIsDragActive(false)}
        onDragOver={(event) => { event.preventDefault(); setIsDragActive(true); }}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { fileInputRef.current?.click(); } }}
      >
        <p>Drag the exported <strong>Jira-Intake.xlsx</strong> (or CSV) here, or click to choose a file.</p>
      </div>
      <input
        accept=".xlsx,.xls,.csv"
        className={styles.hiddenInput}
        data-testid="submission-file-input"
        onChange={handlePicked}
        ref={fileInputRef}
        type="file"
      />
      {errorMessage && <p className={styles.dropzoneError} role="alert">{errorMessage}</p>}
    </div>
  );
}
