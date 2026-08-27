// CondenseMaterialPanel.tsx — Reading a corpus that is far larger than any prompt, in the order that fits.
//
// The material a Feature really needs is rarely one page. It is a folder of emails, a stack of PDFs and
// a shared OneNote notebook nobody can export — hundreds of thousands of characters against a prompt
// that holds sixteen thousand, and the issues being re-written have to fit in there too. Adding all of
// it as shared material does not fail loudly; it divides the budget thirty ways and quietly re-writes
// every Feature from two hundred characters per document.
//
// So this panel walks the corpus in two passes, and shows the arithmetic while it does:
//
//   1. CONDENSE each document on its own, where it has the whole prompt to itself (the map);
//   2. CONSOLIDATE the extracts into one brief, which is where repetition collapses and — the part
//      worth the whole exercise — documents that disagree stop being two plausible statements in a
//      pile and become a named conflict (the reduce).
//
// Every prompt here is the same gated copy-out / paste-back round trip as everywhere else: Toolbox
// never calls an AI service, and nothing written here reaches Jira.

import { useState } from 'react';

import PoAiPanel from '../ai/PoAiPanel';
import {
  buildDocumentExtractPrompts,
  isDocumentExtractEmpty,
  mergeDocumentExtracts,
  parseDocumentExtractReply,
} from './ai/documentExtract.ts';
import type { DocumentExtract } from './ai/documentExtract.ts';
import { buildCorpusBriefPrompt, parseCorpusBriefReply, renderCorpusBrief } from './ai/corpusBrief.ts';
import { MAX_CHARS_PER_PROMPT } from './ai/bulkRewriteAiAssist.ts';
import { MAX_SHARED_MATERIAL_CHARS } from './ai/sharedMaterial.ts';
import type { CorpusBrief } from './ai/corpusBrief.ts';
import { describeSourceTitle, readSourceText } from '../sources/sourceModel.ts';
import type { ReferencedSource } from '../sources/sourceModel.ts';
import styles from './rewrite.module.css';

interface CondenseMaterialPanelProps {
  /** The batch's shared documents, however they arrived. */
  sources: readonly ReferencedSource[];
  /** Extracts already built, keyed by source id. */
  extracts: Readonly<Record<string, DocumentExtract>>;
  /** The consolidated brief, once one exists. */
  brief: CorpusBrief | null;
  /** Stores one document's extract (already merged with any earlier part). */
  onExtractDocument: (extract: DocumentExtract) => void;
  /** Stores the consolidated brief, which the re-write prompts then carry instead of the documents. */
  onBuildBrief: (brief: CorpusBrief) => void;
}

/** Renders a character count the way a person reads it: "148,000", not "148000". */
function formatCharacterCount(characterCount: number): string {
  return characterCount.toLocaleString('en-US');
}

/**
 * The condense workspace: per-document extracts, then one consolidated brief.
 *
 * Renders nothing when the batch has no shared material — there is no corpus to condense, and a panel
 * explaining a problem nobody has is just another thing to read past.
 */
export default function CondenseMaterialPanel({
  sources,
  extracts,
  brief,
  onExtractDocument,
  onBuildBrief,
}: CondenseMaterialPanelProps) {
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  // null means "follow the work": open while anything is outstanding, closed once nothing is.
  const [manualExpansion, setManualExpansion] = useState<boolean | null>(null);

  if (sources.length === 0) {
    return null;
  }

  const rawCorpusChars = sources.reduce((runningTotal, source) => runningTotal + readSourceText(source).length, 0);
  const builtExtracts = sources
    .map((source) => extracts[source.id])
    .filter((extract): extract is DocumentExtract => extract !== undefined);
  const condensedCount = builtExtracts.length;
  const outstandingCount = sources.length - condensedCount;
  // Consolidating is outstanding work too. Folding the panel away with two extracts and no brief
  // would hide the one step that catches two documents contradicting each other.
  const canStillConsolidate = condensedCount >= 2 && brief === null;
  // Follows the work by default: open while anything can still be done here, folded away once
  // nothing can. A manual Show/Hide wins, because somebody looking back at what fed a draft is
  // entitled to see it.
  const isExpanded = manualExpansion ?? (outstandingCount > 0 || canStillConsolidate);
  const openSource = sources.find((source) => source.id === openSourceId) ?? null;
  const openSourcePrompts = openSource === null ? [] : buildDocumentExtractPrompts(openSource);

  /** Ingests one part's reply, merging it onto whatever earlier parts already produced. */
  function handleIngestExtract(source: ReferencedSource, replyText: string): { acceptedCount: number; errors: string[] } {
    try {
      const parsed = parseDocumentExtractReply(replyText, source, new Date().toISOString());
      if (isDocumentExtractEmpty(parsed)) {
        return { acceptedCount: 0, errors: ['That reply had nothing in it — no summary, decisions, requirements, questions or facts.'] };
      }
      const existing = extracts[source.id];
      onExtractDocument(existing === undefined ? parsed : mergeDocumentExtracts(existing, parsed));
      return { acceptedCount: 1, errors: [] };
    } catch (thrownError) {
      return { acceptedCount: 0, errors: [thrownError instanceof Error ? thrownError.message : String(thrownError)] };
    }
  }

  /** Ingests the consolidation reply, checking every source title against the documents actually read. */
  function handleIngestBrief(replyText: string): { acceptedCount: number; errors: string[] } {
    try {
      onBuildBrief(parseCorpusBriefReply(replyText, builtExtracts, new Date().toISOString()));
      return { acceptedCount: 1, errors: [] };
    } catch (thrownError) {
      return { acceptedCount: 0, errors: [thrownError instanceof Error ? thrownError.message : String(thrownError)] };
    }
  }

  return (
    <section className={styles.panel} aria-label="Condense shared material">
      <div className={styles.buttonRow}>
        <h3 className={styles.panelTitle}>
          {`Step 2 — Condense the material (${condensedCount} of ${sources.length} done)`}
        </h3>
        <button className={styles.secondaryButton} type="button" onClick={() => setManualExpansion(!isExpanded)}>
          {isExpanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {/* Once every document is condensed there is nothing to DO here, and a list of finished work
          sits between the operator and Step 3. The count above still says what is feeding the
          prompts, so nothing is hidden — only folded away. */}
      {!isExpanded ? (
        <p className={styles.helpText}>
          {outstandingCount === 0
            ? 'Everything here is condensed and is carried by every prompt in Step 3.'
            : `${outstandingCount} document(s) still to condense.`}
        </p>
      ) : null}

      {isExpanded ? (
        <>
      <p className={styles.panelSubtitle}>
        {`This material runs to ${formatCharacterCount(rawCorpusChars)} characters. One prompt holds about `}
        {`${formatCharacterCount(MAX_CHARS_PER_PROMPT)}, of which the notes may use `}
        {`${formatCharacterCount(MAX_SHARED_MATERIAL_CHARS)} — the issues need the rest. Added raw, each `}
        {'document would be cut to a fraction of itself. Condensing turns each one into a short list of '}
        {'decisions, requirements, open questions and facts that fits whole.'}
      </p>

      <ol className={styles.noticeList} aria-label="How to condense">
        <li>
          {'Press '}<strong>Condense this one</strong>{' on a document below, then '}
          <strong>Build the prompt</strong>{' and '}<strong>Copy</strong>{' it into your assistant.'}
        </li>
        <li>
          {'Paste the assistant’s WHOLE reply back and press '}<strong>Read the reply</strong>
          {'. That document’s line changes to "condensed to N points" — that is how you know it took.'}
        </li>
        <li>
          {'A document too long for one prompt is split into parts. Run '}<strong>every</strong>
          {' part and paste each reply — later parts add to the extract rather than replacing it.'}
        </li>
        <li>{'Repeat for every document in the list. Small ones take one prompt each.'}</li>
        <li>
          {'With two or more condensed, press '}<strong>Consolidate…</strong>
          {' to merge them into one brief that also names where they disagree. Optional, but it is the '}
          {'only step that catches two documents contradicting each other.'}
        </li>
        <li>{'Go to Step 3. The prompts there now carry the condensed material instead of the raw text.'}</li>
      </ol>

      {brief !== null ? (
        <div className={styles.infoBanner}>
          <strong>
            {`Brief ready — ${formatCharacterCount(rawCorpusChars)} characters of material became `}
            {`${formatCharacterCount(renderCorpusBrief(brief).length)}, from ${brief.extractCount} documents.`}
          </strong>
          {brief.conflicts.length > 0 ? (
            <p className={styles.panelSubtitle}>
              {`${brief.conflicts.length} conflict(s) found — these documents disagree, and the re-write is told not `}
              {'to assume either side: '}
              {brief.conflicts.map((conflict) => conflict.subject).join('; ')}
            </p>
          ) : null}
          <p className={styles.helpText}>The re-write prompts now carry this brief instead of the documents.</p>
        </div>
      ) : null}

      <ul className={styles.noticeList} aria-label="Documents to condense">
        {sources.map((source) => {
          const sourceExtract = extracts[source.id];
          const sourceChars = readSourceText(source).length;
          const isOpen = source.id === openSourceId;
          return (
            <li key={source.id}>
              <strong>{describeSourceTitle(source)}</strong>
              {` — ${formatCharacterCount(sourceChars)} characters · `}
              {sourceExtract === undefined
                ? 'not condensed yet'
                : `condensed to ${formatCharacterCount(
                  sourceExtract.decisions.length + sourceExtract.requirements.length
                    + sourceExtract.openQuestions.length + sourceExtract.facts.length,
                )} points`}
              {' '}
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setOpenSourceId(isOpen ? null : source.id)}
              >
                {isOpen ? 'Close' : sourceExtract === undefined ? 'Condense this one' : 'Condense again'}
              </button>
            </li>
          );
        })}
      </ul>

      {/* One panel per part. A long notebook page is split rather than truncated, and ingesting part
          two ADDS to part one — a reply that replaced it would leave an extract of the document's
          last quarter wearing the whole document's name. */}
      {openSource !== null
        ? openSourcePrompts.map((promptText, partIndex) => (
          <PoAiPanel
            key={`${openSource.id}-part-${partIndex}`}
            title={openSourcePrompts.length > 1
              ? `Condense "${describeSourceTitle(openSource)}" — part ${partIndex + 1} of ${openSourcePrompts.length}`
              : `Condense "${describeSourceTitle(openSource)}"`}
            helpText={openSourcePrompts.length > 1
              ? `Part ${partIndex + 1} of ${openSourcePrompts.length}. Build it, copy it into your assistant, `
                + 'paste the whole reply back and press Read the reply. Do the same for every part — each one '
                + 'ADDS to this document’s extract rather than replacing it, so skipping a part loses that '
                + 'section of the document. Nothing reaches Jira.'
              : 'Build it, copy it into your assistant, then paste the whole reply back and press Read the '
                + 'reply. It asks for this one document reduced to its decisions, requirements, open questions '
                + 'and facts. The document’s line above will change to "condensed to N points" when it '
                + 'has taken. Nothing reaches Jira.'}
            buildPrompt={() => promptText}
            onIngest={(replyText) => handleIngestExtract(openSource, replyText)}
          />
        ))
        : null}

      {builtExtracts.length >= 2 ? (
        <PoAiPanel
          title={`Consolidate ${builtExtracts.length} extracts into one brief`}
          helpText={'Build it, copy it into your assistant, then paste the whole reply back and press Read '
            + 'the reply. It says what several documents agree on ONCE, and — the part worth the whole '
            + 'exercise — names the places where two of them disagree instead of quietly picking one. The '
            + 'brief then replaces the individual documents in every Step 3 prompt.'}
          buildPrompt={() => buildCorpusBriefPrompt(builtExtracts)}
          onIngest={handleIngestBrief}
        />
      ) : (
        <p className={styles.helpText}>
          {`Condense at least two documents to consolidate them into a brief (${builtExtracts.length} done).`}
        </p>
      )}
        </>
      ) : null}
    </section>
  );
}
