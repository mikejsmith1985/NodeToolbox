// ChecklistDiagnosticsPanel.tsx — What this Jira actually stores in its Smart Checklist field.
//
// Written because the alternative was worse: three separate times, working out why the board showed
// nothing meant asking the user to open a REST URL on a machine only they can reach and read JSON out
// of a browser tab. The information was always one request away from the app itself.
//
// It shows three things, in the order they answer the question:
//
//   1. which fields on this instance look like a checklist at all — if none, nothing else matters
//   2. the RAW value stored on a real issue — text? structured objects? absent entirely?
//   3. what the board's own parser made of it — which is where a mismatch becomes obvious
//
// Deliberately behind two gates (Admin Hub unlocked AND diagnostics switched on) because raw custom
// field ids are noise to everyone who is not currently debugging, and a panel of them reads as
// something broken.

import { useState } from 'react';

import { jiraGet } from '../../../../services/jiraApi.ts';
import { findChecklistFieldId, parseChecklistItems } from '../checklistItems.ts';
import styles from '../RollupBoardTab.module.css';

/** How much of a raw value to show. Enough to recognise the shape, short of a wall of text. */
const RAW_VALUE_PREVIEW_LENGTH = 600;

/** One checklist-ish field this instance exposes. */
interface ChecklistFieldCandidate {
  id: string;
  name: string;
  schemaType: string;
}

interface ChecklistProbeResult {
  candidates: ChecklistFieldCandidate[];
  /** Which field the board would actually use, by its own discovery rule. */
  chosenFieldId: string | null;
  /** The raw stored value on the sampled issue, JSON-encoded so its SHAPE is visible. */
  rawValueByFieldId: Record<string, string>;
  parsedItemCount: number | null;
  errorMessage: string | null;
}

/** Renders a value so its type is unmistakable — a string and an object must not look alike. */
function previewRawValue(rawValue: unknown): string {
  if (rawValue === undefined) return '(field not present on this issue)';
  if (rawValue === null) return 'null';

  const encoded = typeof rawValue === 'string' ? JSON.stringify(rawValue) : JSON.stringify(rawValue, null, 1);
  return encoded.length > RAW_VALUE_PREVIEW_LENGTH
    ? `${encoded.slice(0, RAW_VALUE_PREVIEW_LENGTH)}… (${encoded.length} chars total)`
    : encoded;
}

/** Reads the field catalogue and one issue, and reports what the board would make of them. */
async function probeChecklistField(issueKey: string): Promise<ChecklistProbeResult> {
  const emptyResult: ChecklistProbeResult = {
    candidates: [], chosenFieldId: null, rawValueByFieldId: {}, parsedItemCount: null, errorMessage: null,
  };

  try {
    const fieldCatalog = await jiraGet<{ id?: string; name?: string; schema?: { custom?: string } }[]>(
      '/rest/api/2/field',
    );
    const candidates = (fieldCatalog ?? [])
      .filter((field) => /checklist/i.test(String(field.name ?? ''))
        || /checklist/i.test(String(field.schema?.custom ?? '')))
      .map((field) => ({
        id: String(field.id ?? ''),
        name: String(field.name ?? ''),
        schemaType: String(field.schema?.custom ?? ''),
      }));

    const chosenFieldId = findChecklistFieldId(fieldCatalog ?? []);
    if (issueKey.trim() === '') {
      return { ...emptyResult, candidates, chosenFieldId };
    }

    // Asking for the WHOLE issue rather than named fields: a field the board never requests is
    // exactly the kind of thing this panel exists to reveal.
    const issue = await jiraGet<{ fields?: Record<string, unknown> }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey.trim())}`,
    );
    const issueFields = issue.fields ?? {};

    const rawValueByFieldId: Record<string, string> = {};
    for (const candidate of candidates) rawValueByFieldId[candidate.id] = previewRawValue(issueFields[candidate.id]);

    return {
      candidates,
      chosenFieldId,
      rawValueByFieldId,
      parsedItemCount: chosenFieldId ? parseChecklistItems(issueFields[chosenFieldId]).length : null,
      errorMessage: null,
    };
  } catch (probeError: unknown) {
    return { ...emptyResult, errorMessage: String(probeError) };
  }
}

/** The Board setup panel that reports what this Jira stores in its checklist field. */
export function ChecklistDiagnosticsPanel() {
  const [issueKeyInput, setIssueKeyInput] = useState('');
  const [probeResult, setProbeResult] = useState<ChecklistProbeResult | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  async function runProbe(): Promise<void> {
    setIsProbing(true);
    try {
      setProbeResult(await probeChecklistField(issueKeyInput));
    } finally {
      setIsProbing(false);
    }
  }

  return (
    <div className={styles.panelCard} data-testid="rollup-checklist-diagnostics">
      <h4 className={styles.sectionTitle}>Checklist field diagnostics</h4>
      <p className={styles.fieldLabel}>
        Reports which field this Jira uses for Smart Checklists and what it actually stores, so a card
        showing no checklist can be explained without reading REST responses by hand.
      </p>

      <div className={styles.editorRow}>
        <input
          aria-label="Issue key to sample"
          className={styles.inputField}
          disabled={isProbing}
          onChange={(changeEvent) => setIssueKeyInput(changeEvent.target.value)}
          onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter') void runProbe(); }}
          placeholder="e.g. ENCUC-2311"
          value={issueKeyInput}
        />
        <button className={styles.actionButton} disabled={isProbing} onClick={() => void runProbe()} type="button">
          {isProbing ? 'Checking…' : 'Check'}
        </button>
      </div>

      {probeResult?.errorMessage && (
        <p className={styles.editorError}>Jira refused the read: {probeResult.errorMessage}</p>
      )}

      {probeResult !== null && probeResult.errorMessage === null && (
        <>
          <p className={styles.fieldLabel}>
            {probeResult.candidates.length === 0
              ? 'No field on this instance looks like a checklist — the board cannot draw checklist'
                + ' items here at all, and that is the whole explanation.'
              : `${probeResult.candidates.length} checklist-like field(s). The board would use`
                + ` ${probeResult.chosenFieldId ?? 'none of them'}.`}
          </p>

          {probeResult.candidates.map((candidate) => (
            <div className={styles.diagnosticRow} key={candidate.id}>
              <code className={styles.diagnosticKey}>
                {candidate.id}{candidate.id === probeResult.chosenFieldId ? '  ← used' : ''}
              </code>
              <span className={styles.fieldLabel}>{candidate.name} · {candidate.schemaType || 'no schema type'}</span>
              {probeResult.rawValueByFieldId[candidate.id] !== undefined && (
                <pre className={styles.diagnosticValue}>{probeResult.rawValueByFieldId[candidate.id]}</pre>
              )}
            </div>
          ))}

          {probeResult.parsedItemCount !== null && (
            <p className={styles.fieldLabel}>
              The board&apos;s parser read <strong>{probeResult.parsedItemCount}</strong> item(s) from that value.
              {probeResult.parsedItemCount === 0
                && ' Zero here with a non-empty value above means the stored format is not the one the'
                  + ' parser expects — send that raw value and it can be supported.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
