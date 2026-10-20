// ctaskTemplateShare.ts — Turns every saved CTASK template into one code or file, and safely back, so Toolbox and the SNow Wizard can swap them.
//
// Toolbox runs on this machine and the SNow Wizard runs inside ServiceNow's own site, so their browser storage is
// separate: the only way across is text the user copies or a file they download. Both sides use this one module,
// so the two can never disagree about the format. Reading a code never throws to the screen — every problem comes
// back as a plain sentence — and only known task values travel (personal raw-field pins never do).

import { DAMAGED_TEMPLATE_MESSAGE, TemplateShareFormatError, isPlainObject, readSharedTasks } from '../../snowWizard/change/templateShareFormat.ts';
import type { CtaskTemplate } from './hooks/useCrgState.ts';

/** The start of every task code; the number is the format version. */
export const CTASK_SHARE_PREFIX = 'SNOWWIZ-CTASKS-1:';
const CTASK_SHARE_FAMILY = 'SNOWWIZ-CTASKS-';
const CTASK_SHARE_VERSION = 1;
/** The name a downloaded task file is saved under. */
export const CTASK_SHARE_FILE_NAME = 'ctask-templates.snow-tasks.json';
// Far above any real set of templates; stops a pasted novel from freezing the page.
const MAX_SHARE_TEXT_LENGTH = 1_000_000;
const JSON_INDENT_SPACES = 2;
const BASE64_BLOCK_LENGTH = 4;
const FALLBACK_TASK_NAME = 'Task';
// The object URL is released once the browser has started the download.
const DOWNLOAD_URL_RELEASE_MS = 1000;
const NEWER_VERSION_MESSAGE = 'These tasks were shared from a newer version. Update, then try again.';
const NO_TASKS_MESSAGE = 'This code has no tasks in it. Ask for it again.';

/** What a task code or file carries. */
export interface SharedCtaskTemplatesPayload {
  version: typeof CTASK_SHARE_VERSION;
  ctaskTemplates: CtaskTemplate[];
}

/** A read task code: the task templates, or the plain reason they cannot be used. */
export type CtaskShareDecodeResult = { isValid: true; ctaskTemplates: CtaskTemplate[] } | { isValid: false; errorMessage: string };

// ── Text encoding (shared with the change template code) ──

/** Text → URL-safe base64 that survives accents and symbols (UTF-8 first, then base64). */
export function encodeBase64Url(plainText: string): string {
  let binaryText = '';
  for (const byte of new TextEncoder().encode(plainText)) binaryText += String.fromCharCode(byte);
  return btoa(binaryText).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe base64 → text; throws on anything that is not valid base64 or UTF-8. */
export function decodeBase64Url(encodedText: string): string {
  const standardText = encodedText.replace(/-/g, '+').replace(/_/g, '/');
  const paddedText = standardText + '='.repeat((BASE64_BLOCK_LENGTH - (standardText.length % BASE64_BLOCK_LENGTH)) % BASE64_BLOCK_LENGTH);
  const bytes = Uint8Array.from(atob(paddedText), (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ── Encoding ──

/** The payload for a set of templates: each one rebuilt from known values only, so nothing unexpected travels. */
function buildPayload(ctaskTemplates: readonly CtaskTemplate[]): SharedCtaskTemplatesPayload {
  const namedTemplates = ctaskTemplates.map((template) => ({
    ...template,
    name: template.name.trim() || template.shortDescription.trim() || FALLBACK_TASK_NAME,
  }));
  return { version: CTASK_SHARE_VERSION, ctaskTemplates: readSharedTasks(namedTemplates) };
}

/** One line of text holding every given task template, for pasting into the other tool, Teams or an email. */
export function encodeCtaskTemplatesShareCode(ctaskTemplates: readonly CtaskTemplate[]): string {
  return `${CTASK_SHARE_PREFIX}${encodeBase64Url(JSON.stringify(buildPayload(ctaskTemplates)))}`;
}

/** The same payload as a downloadable file. */
export function buildCtaskTemplatesShareFile(ctaskTemplates: readonly CtaskTemplate[]): { fileName: string; blob: Blob } {
  const fileText = JSON.stringify(buildPayload(ctaskTemplates), null, JSON_INDENT_SPACES);
  return { fileName: CTASK_SHARE_FILE_NAME, blob: new Blob([fileText], { type: 'application/json' }) };
}

/** Hands a share file to the browser's own download, so it lands in the user's Downloads folder. */
export function downloadShareFile(shareFile: { fileName: string; blob: Blob }): void {
  const objectUrl = URL.createObjectURL(shareFile.blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = shareFile.fileName;
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_RELEASE_MS);
}

// ── Decoding ──

/** The parsed JSON when the text is a JSON object, else null. */
function parseJsonObject(trimmedText: string): Record<string, unknown> | null {
  if (!trimmedText.startsWith('{')) return null;
  try {
    const parsedValue: unknown = JSON.parse(trimmedText);
    return isPlainObject(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

/** True when pasted text (or a file's text) is a task code rather than a change template code. */
export function isCtaskTemplatesShareText(text: string): boolean {
  const trimmedText = text.trim();
  if (trimmedText.startsWith(CTASK_SHARE_FAMILY)) return true;
  const parsedObject = parseJsonObject(trimmedText);
  return parsedObject !== null && Array.isArray(parsedObject.ctaskTemplates) && parsedObject.template === undefined;
}

/** The JSON a pasted code or file holds, or the plain reason it is not one. */
function readShareJson(trimmedText: string): unknown {
  if (trimmedText.startsWith(CTASK_SHARE_PREFIX)) return JSON.parse(decodeBase64Url(trimmedText.slice(CTASK_SHARE_PREFIX.length)));
  if (trimmedText.startsWith(CTASK_SHARE_FAMILY)) throw new TemplateShareFormatError(NEWER_VERSION_MESSAGE);
  if (trimmedText.startsWith('{')) return JSON.parse(trimmedText);
  throw new TemplateShareFormatError(`That is not a task code. A task code starts with ${CTASK_SHARE_PREFIX}`);
}

/** The checked task templates from parsed JSON. */
function readPayload(parsedValue: unknown): CtaskTemplate[] {
  if (!isPlainObject(parsedValue)) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  if (parsedValue.version !== CTASK_SHARE_VERSION) throw new TemplateShareFormatError(NEWER_VERSION_MESSAGE);
  if (!Array.isArray(parsedValue.ctaskTemplates)) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  const ctaskTemplates = readSharedTasks(parsedValue.ctaskTemplates);
  if (ctaskTemplates.length === 0) throw new TemplateShareFormatError(NO_TASKS_MESSAGE);
  return ctaskTemplates;
}

/** Reads a pasted task code or a task file's text. Never throws: a problem comes back as a plain sentence. */
export function decodeCtaskTemplatesShare(text: string): CtaskShareDecodeResult {
  const trimmedText = text.trim();
  if (trimmedText === '') return { isValid: false, errorMessage: 'Paste a task code first.' };
  if (trimmedText.length > MAX_SHARE_TEXT_LENGTH) return { isValid: false, errorMessage: 'That is far too long to be a task code.' };
  try {
    return { isValid: true, ctaskTemplates: readPayload(readShareJson(trimmedText)) };
  } catch (unknownError) {
    return { isValid: false, errorMessage: unknownError instanceof TemplateShareFormatError ? unknownError.message : DAMAGED_TEMPLATE_MESSAGE };
  }
}
