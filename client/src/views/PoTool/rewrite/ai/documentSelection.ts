// documentSelection.ts — Asking which documents are needed, before fetching any of them.
//
// A document library holds hundreds of files. Fetching all of them to find the three that matter
// would be slow, would blow every prompt budget several times over, and would bury the useful
// material in the rest — which is the same as not having found it.
//
// So the round trip has two halves. Toolbox walks the library and hands over the NAMES; the
// assistant replies with a shortlist; Toolbox fetches only those and attaches them as shared
// material. The assistant never touches SharePoint, and Toolbox never guesses at relevance — each
// does the half it is actually able to do.
//
// The half that has to be strict is the reply. A name the assistant invented must be refused rather
// than fetched: at best the fetch fails confusingly, at worst it matches a different document and
// the re-writes are made from material nobody chose.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';

export const DOCUMENT_SELECTION_REPLY_KIND = 'documentSelection';

/** One document the library holds, as the browser found it. */
export interface LibraryDocument {
  name: string;
  /** The folder it sits in, because two folders can hold the same file name. */
  folderPath: string;
  modifiedAtIso: string;
}

/** Which documents the assistant asked for, and which it asked for that do not exist. */
export interface DocumentSelectionResult {
  selectedNames: string[];
  /** Names not in the library. Reported rather than dropped, so a bad reply is visible. */
  rejectedNames: string[];
}

/**
 * Builds the prompt that asks which documents are worth reading.
 *
 * Each entry carries its folder and its date, not just its name: two folders can hold the same file
 * name, and when a document last changed is what tells a reader whether they are looking at the
 * current standard or last year's.
 *
 * Returns an empty string when the library held nothing readable — an instruction listing nothing
 * still costs somebody's attention and gets a confidently useless answer.
 */
export function buildDocumentSelectionPrompt(documents: readonly LibraryDocument[], taskDescription: string): string {
  if (documents.length === 0) {
    return '';
  }

  const documentLines = documents.map((document) => {
    const modifiedDay = document.modifiedAtIso.slice(0, 10);
    return `  - ${document.name}  (in ${document.folderPath}${modifiedDay === '' ? '' : `, last changed ${modifiedDay}`})`;
  });

  return [
    'You are choosing which documents are worth reading for a piece of work. You cannot open them yet —',
    'you are picking from their names so that only the relevant ones are fetched.',
    '',
    `The work: ${taskDescription}`,
    '',
    'The library holds these documents:',
    ...documentLines,
    '',
    'Reply with the ones worth reading. Copy each name EXACTLY as listed above — a name that is not in',
    'the list will be refused, and inventing one wastes the whole round trip. Choosing none is a valid',
    'answer if nothing here is relevant.',
    '',
    'Reply with ONLY this JSON:',
    `{"kind":"${DOCUMENT_SELECTION_REPLY_KIND}","documents":["Exact Name.md"]}`,
  ].join('\n');
}

/**
 * Parses the shortlist, keeping only names the library actually holds.
 *
 * Throws only when the reply is unusable as a whole — not JSON, or a different kind of reply.
 * A single bad NAME is not fatal: it is reported alongside the good ones, because refusing the
 * entire selection over one invented entry would throw away a correct answer to punish a typo.
 */
export function parseDocumentSelectionReply(replyText: string, knownNames: readonly string[]): DocumentSelectionResult {
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== DOCUMENT_SELECTION_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${DOCUMENT_SELECTION_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }

  const knownNameSet = new Set(knownNames);
  const requestedNames = Array.isArray(parsed.documents) ? parsed.documents : [];

  const selectedNames: string[] = [];
  const rejectedNames: string[] = [];
  requestedNames.forEach((rawName) => {
    if (typeof rawName !== 'string') {
      return;
    }
    const name = rawName.trim();
    if (name === '') {
      return;
    }
    const target = knownNameSet.has(name) ? selectedNames : rejectedNames;
    if (!target.includes(name)) {
      target.push(name);
    }
  });

  return { selectedNames, rejectedNames };
}
