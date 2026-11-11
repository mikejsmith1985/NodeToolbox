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
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores a request for JSON, so the prompt asks for a
// labelled list, one exact name per line. A list rather than a fill-in table on purpose: a library lists hundreds of
// names, and a table repeating every one of them back would be cut short long before the few that matter. A JSON
// reply is still read.

import { readReplySections, type ReplySection } from '../../../../utils/aiReplySections.ts';
import { splitReplyCellsKeepingBlanks } from '../../../../utils/aiReplyTable.ts';
import { isEmptyListEntry, readKindedJsonReply, readListEntryText } from './replyListSections.ts';

export const DOCUMENT_SELECTION_REPLY_KIND = 'documentSelection';

/** The label the shortlist follows, and the headings an answer engine writes for it instead. */
const SELECTION_SECTION: ReplySection<'documents'> = {
  key: 'documents',
  marker: 'DOCUMENTS_TO_READ',
  headingPattern: /^(?:documents?|files?) (?:to read|worth reading)$|^(?:selected|recommended|relevant) (?:documents|files)$|^shortlist$/i,
};

/** The error shown when a reply is neither the list nor JSON — the wording every round already uses. */
const UNREADABLE_REPLY_MESSAGE = 'No JSON object found in the assistant response.';
// A markdown link around a name: "[Q1 Retro.txt](https://…)".
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\([^)]*\)/g;
// A table's header cell above the names: "Document", "File name", "Name".
const NAME_HEADER_CELL_PATTERN = /^(?:document|file|name|document name|file name)s?$/i;

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
    ...describeSelectionReplyForm(),
  ].join('\n');
}

/** The reply form: the label, then one exact name per line — what an answer engine follows. */
function describeSelectionReplyForm(): string[] {
  return [
    `Answer with the line ${SELECTION_SECTION.marker}: and then one document name per line, starting with "- ",`,
    'copied exactly — no folder, no date, no reason. When none is worth reading, write "- None". Do not answer in',
    'JSON or a table, write nothing before the label or after the list, and ask no questions.',
    `${SELECTION_SECTION.marker}:`,
  ];
}

/** The follow-up for the same AI chat when the reply could not be read: the same form, asking for nothing new. */
export function buildDocumentSelectionFollowUpPrompt(): string {
  return [
    'Your last reply was not in the form I need, so it could not be read. Keep the documents you chose, but list them like this.',
    ...describeSelectionReplyForm(),
  ].join('\n');
}

/** True when a selection reply could not be read at all — the cue to offer the follow-up. */
export function isUnreadableDocumentSelectionReply(replyText: string): boolean {
  return readKindedJsonReply(replyText) === null && readListedNames(replyText) === null;
}

/**
 * The names a list reply gave, or null when it holds no list. Each line is the name alone, a table row whose first
 * cell is the name, or a name followed by the folder or a reason — the known name it starts with is taken, never a
 * near match, so a name the library does not hold is still refused.
 */
function readListedNames(replyText: string, knownNames: readonly string[] = []): string[] | null {
  const sectionText = readReplySections(replyText, [SELECTION_SECTION]).documents;
  if (sectionText === undefined) return null;
  // Longest first, so "Retro.txt" is never read inside "Q1 Retro.txt".
  const knownNamesLongestFirst = [...knownNames].sort((first, second) => second.length - first.length);
  return sectionText
    .split(/\r?\n/)
    .map((replyLine) => readListedNameLine(replyLine, knownNamesLongestFirst))
    .filter((listedName) => listedName !== '' && !isEmptyListEntry(listedName) && !NAME_HEADER_CELL_PATTERN.test(listedName));
}

/** One list line as the name it gives: a known name it starts with when there is one, else the line as written. */
function readListedNameLine(replyLine: string, knownNamesLongestFirst: readonly string[]): string {
  const tableCells = splitReplyCellsKeepingBlanks(replyLine);
  const lineText = readListEntryText(tableCells.length > 0 ? tableCells[0] : replyLine).replace(MARKDOWN_LINK_PATTERN, '$1');
  const knownName = knownNamesLongestFirst.find((candidateName) => lineText.startsWith(candidateName));
  return knownName ?? lineText;
}

/**
 * Parses the shortlist, keeping only names the library actually holds.
 *
 * Throws only when the reply is unusable as a whole — neither the labelled list nor JSON, or a different kind of reply.
 * A single bad NAME is not fatal: it is reported alongside the good ones, because refusing the
 * entire selection over one invented entry would throw away a correct answer to punish a typo.
 */
export function parseDocumentSelectionReply(replyText: string, knownNames: readonly string[]): DocumentSelectionResult {
  const knownNameSet = new Set(knownNames);
  const requestedNames = readRequestedNames(replyText, knownNames);

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

/**
 * The names the reply asked for, from either form: a JSON reply (checked for its kind) or the labelled list. Throws
 * when the reply is neither, so the caller says it could not be read.
 */
function readRequestedNames(replyText: string, knownNames: readonly string[]): unknown[] {
  const jsonPayload = readKindedJsonReply(replyText);
  if (jsonPayload !== null) {
    if (jsonPayload.kind !== DOCUMENT_SELECTION_REPLY_KIND) {
      throw new Error(`Expected an AI reply with {"kind":"${DOCUMENT_SELECTION_REPLY_KIND}"}, got "${String(jsonPayload.kind)}".`);
    }
    return Array.isArray(jsonPayload.documents) ? jsonPayload.documents : [];
  }
  const listedNames = readListedNames(replyText, knownNames);
  if (listedNames === null) {
    throw new Error(UNREADABLE_REPLY_MESSAGE);
  }
  return listedNames;
}
