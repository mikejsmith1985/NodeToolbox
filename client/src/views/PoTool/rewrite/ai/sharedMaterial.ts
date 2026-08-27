// sharedMaterial.ts — One set of documents, applied to every Feature in a batch.
//
// The batch could only ever re-write an issue from its OWN text. That is backwards for the job
// people actually have: a new standard, a compliance note, a design decision — one document that
// changes a dozen Features at once. Without this the PO pasted the same material into a dozen
// separate runs and hoped the answers came back consistent.
//
// Two rules make it safe. The material is CAPPED, so a two-hundred-page standard cannot crowd out
// the work being re-written; and when it is cut, the prompt says so, because a prompt that quietly
// dropped half its input produces re-writes nobody can account for afterwards.
//
// The block this builds is repeated in every prompt part. That is the caller's job, and it matters:
// a large batch is split across prompts, and material carried only in part one would leave every
// issue after the split re-written from nothing.

import { describeSourceTitle, readSourceText } from '../../sources/sourceModel.ts';
import type { ReferencedSource } from '../../sources/sourceModel.ts';
import { renderCorpusBrief } from './corpusBrief.ts';
import type { CorpusBrief } from './corpusBrief.ts';

/**
 * The most shared material one prompt will carry.
 *
 * Sized so the documents inform the re-write without displacing the issues. The issues are the point;
 * the material is context, and context that leaves no room for the subject has stopped being useful.
 */
export const MAX_SHARED_MATERIAL_CHARS = 6000;

/** Trims one document to its share of the budget and says plainly when it was cut. */
function capDocumentText(text: string, budgetChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= budgetChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, budgetChars)}\n… (truncated)`;
}

/**
 * Renders the shared documents as one prompt block, or an empty string when there are none.
 *
 * The budget is divided EVENLY across the documents that have text rather than spent first-come.
 * Spending it in order would let one long document silently swallow every one after it, and the PO
 * who added a short decisive note last would never learn it had been dropped.
 */
export function buildSharedMaterialBlock(
  sources: readonly ReferencedSource[],
  /**
   * A brief consolidated from these documents, when one has been built.
   *
   * When present it REPLACES the raw documents rather than joining them. That is the entire point of
   * building one: a corpus that did not fit is now a block that does, and pasting the originals back
   * in beside it would restore the problem the consolidation just solved.
   */
  brief: CorpusBrief | null = null,
): string {
  if (brief !== null) {
    return [
      `Shared material — consolidated from ${brief.extractCount} documents. This applies to EVERY issue`,
      'in this prompt, not just the first:',
      renderCorpusBrief(brief),
    ].join('\n');
  }

  const documentsWithText = sources
    .map((source) => ({ title: describeSourceTitle(source), text: readSourceText(source).trim() }))
    .filter((document) => document.text !== '');

  if (documentsWithText.length === 0) {
    return '';
  }

  const budgetPerDocument = Math.floor(MAX_SHARED_MATERIAL_CHARS / documentsWithText.length);
  const renderedDocuments = documentsWithText.map((document) =>
    [`### ${document.title}`, capDocumentText(document.text, budgetPerDocument)].join('\n'));

  return [
    'Shared material — this applies to EVERY issue in this prompt, not just the first:',
    renderedDocuments.join('\n\n'),
  ].join('\n');
}
