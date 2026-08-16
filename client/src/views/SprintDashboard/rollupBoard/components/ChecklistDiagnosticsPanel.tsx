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
import {
  chooseChecklistFieldByValue,
  findChecklistFieldId,
  parseChecklistItems,
  readDumpStatusWords,
} from '../checklistItems.ts';
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
  /** Which field the board would actually use. Null when no candidate yields a single item. */
  chosenFieldId: string | null;
  /** The raw stored value on the sampled issue, JSON-encoded so its SHAPE is visible. */
  rawValueByFieldId: Record<string, string>;
  /**
   * What the board's parser made of EVERY candidate, not only the winner.
   *
   * Reporting the winner alone answered nothing in the case that matters most — when no field parses
   * at all there is no winner, and the panel fell silent exactly when it was needed.
   */
  parsedItemCountByFieldId: Record<string, number>;
  /**
   * What the parser made of each item in the CHOSEN field: its text, the state it resolved to, and
   * the status words it resolved that state FROM.
   *
   * The counts alone could not explain the case that actually happened — an item set to In progress
   * in Jira reading as To do on the board. The count was right; the state was wrong; and nothing on
   * screen showed which of the app's two status fields the parser had been looking at.
   */
  parsedItems: Array<{ text: string; state: string; statusWords: string }>;
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

/**
 * The status words behind one item, found by locating that item's own block in the stored dump.
 *
 * Reported rather than inferred: when the board and Jira disagree about an item's state, the useful
 * question is not "what did the parser decide" but "what was it looking at when it decided".
 */
function readDumpStatusWordsForItem(rawValue: unknown, itemText: string): string {
  const dumpText = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue ?? '');
  const itemBlocks = dumpText.split('Item(').slice(1);
  const owningBlock = itemBlocks.find((itemBlock) => itemBlock.includes(itemText));
  return owningBlock === undefined ? '' : readDumpStatusWords(owningBlock);
}

/** Reads the field catalogue and one issue, and reports what the board would make of them. */
async function probeChecklistField(issueKey: string): Promise<ChecklistProbeResult> {
  const emptyResult: ChecklistProbeResult = {
    candidates: [], chosenFieldId: null, rawValueByFieldId: {}, parsedItemCountByFieldId: {},
    parsedItems: [], errorMessage: null,
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

    // Without an issue there is no value to judge by, so the best that can be said is which field
    // the NAME would pick. It is labelled as a guess below for exactly that reason.
    if (issueKey.trim() === '') {
      return { ...emptyResult, candidates, chosenFieldId: findChecklistFieldId(fieldCatalog ?? []) };
    }

    // Asking for the WHOLE issue rather than named fields: a field the board never requests is
    // exactly the kind of thing this panel exists to reveal.
    const issue = await jiraGet<{ fields?: Record<string, unknown> }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey.trim())}`,
    );
    const issueFields = issue.fields ?? {};

    const rawValueByFieldId: Record<string, string> = {};
    const parsedItemCountByFieldId: Record<string, number> = {};
    for (const candidate of candidates) {
      rawValueByFieldId[candidate.id] = previewRawValue(issueFields[candidate.id]);
      parsedItemCountByFieldId[candidate.id] = parseChecklistItems(issueFields[candidate.id]).length;
    }

    // The SAME choice the board makes, not a second rule that happens to agree today. This panel
    // previously reported the name-first pick while the board read the value-first one, so on the
    // very instance it was built to explain it named a different field than the board was using.
    const chosenFieldId = chooseChecklistFieldByValue(
      candidates.map((candidate) => candidate.id),
      issueFields,
    );
    // Read back through the SAME parser the board uses, reporting the status words each state came
    // from — the one string a "Jira says In progress, the board says To do" disagreement turns on.
    const chosenRawValue = chosenFieldId === null ? null : issueFields[chosenFieldId];
    const parsedItems = parseChecklistItems(chosenRawValue).map((item) => ({
      text: item.text,
      state: item.state,
      statusWords: readDumpStatusWordsForItem(chosenRawValue, item.text),
    }));

    return {
      candidates,
      chosenFieldId,
      rawValueByFieldId,
      parsedItemCountByFieldId,
      parsedItems,
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
              {probeResult.parsedItemCountByFieldId[candidate.id] !== undefined && (
                <span className={styles.fieldLabel}>
                  The board&apos;s parser read{' '}
                  <strong>{probeResult.parsedItemCountByFieldId[candidate.id]}</strong> item(s) from this value.
                </span>
              )}
              {probeResult.rawValueByFieldId[candidate.id] !== undefined && (
                <pre className={styles.diagnosticValue}>{probeResult.rawValueByFieldId[candidate.id]}</pre>
              )}
            </div>
          ))}

          {/* What the parser made of each item, beside the state Jira shows. An item reading To do on
              the board while Jira says In progress is a disagreement about ONE string, and this is
              the string. */}
          {probeResult.parsedItems.length > 0 && (
            <div className={styles.diagnosticRow}>
              <span className={styles.fieldLabel}>Items the board read, and the state each resolved to:</span>
              {probeResult.parsedItems.map((parsedItem) => (
                <pre className={styles.diagnosticValue} key={parsedItem.text}>
                  {parsedItem.text} → {parsedItem.state}
                  {'\n'}from status: {parsedItem.statusWords || '(no status found in the stored value)'}
                </pre>
              ))}
            </div>
          )}

          {/* The case the panel exists for. Reporting only the WINNER's count said nothing here,
              because when nothing parses there is no winner — it fell silent exactly when needed. */}
          {probeResult.candidates.length > 0 && probeResult.chosenFieldId === null && (
            <p className={styles.fieldLabel}>
              No field yielded a single item, so the board can draw no checklist from this issue. Zero
              against a non-empty value above means the stored format is not the one the parser expects
              — send that raw value and it can be supported.
            </p>
          )}
        </>
      )}
    </div>
  );
}
