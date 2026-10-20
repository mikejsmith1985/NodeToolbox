// templateShare.ts — Turns a saved change template into a code or file people can pass on, and safely back into a template.
//
// There is no server to share through, so a template travels as text: a single code people paste into Teams or an
// email, or the same payload as a downloadable `.snow-template.json` file. Reading one back never throws to the
// screen — every problem comes back as a plain sentence — and an import always gets fresh ids and a free name.

import type { CrgTemplateData } from '../../views/SnowHub/hooks/crgTemplateData.ts';
import type { CrgTemplate, CtaskTemplate, CtaskTemplateData } from '../../views/SnowHub/hooks/useCrgState.ts';
import {
  DAMAGED_TEMPLATE_MESSAGE, TemplateShareFormatError, isPlainObject, readSharedTasks, readSharedTemplate,
} from './templateShareFormat.ts';

/** The start of every template code; the number is the format version. */
export const TEMPLATE_SHARE_PREFIX = 'SNOWWIZ-TEMPLATE-1:';
const TEMPLATE_SHARE_FAMILY = 'SNOWWIZ-TEMPLATE-';
const TEMPLATE_SHARE_VERSION = 1;
const SHARE_FILE_SUFFIX = '.snow-template.json';
const FALLBACK_FILE_NAME = 'change-template';
// Far above any real template; stops a pasted novel from freezing the page.
const MAX_SHARE_TEXT_LENGTH = 1_000_000;
const JSON_INDENT_SPACES = 2;
const BASE64_BLOCK_LENGTH = 4;
const SHARED_NAME_SUFFIX = 'shared';
const FIRST_NUMBERED_COPY = 2;
const NEWER_VERSION_MESSAGE = 'This template was made by a newer version of the Wizard. Update the Wizard, then try again.';

/** What a code or file carries. */
export interface SharedTemplatePayload {
  version: typeof TEMPLATE_SHARE_VERSION;
  template: CrgTemplate;
  ctaskTemplates: CtaskTemplate[];
}

/** A read code: the template, or the plain reason it cannot be used. */
export type TemplateShareDecodeResult = { isValid: true; payload: SharedTemplatePayload } | { isValid: false; errorMessage: string };

/** Where an import saves to — the existing template hooks' own save functions. */
export interface TemplateImportSinks {
  existingTemplateNames: readonly string[];
  saveCrgTemplate: (name: string, templateData: CrgTemplateData) => string;
  saveCtaskTemplate: (name: string, templateData: CtaskTemplateData) => string;
}

// ── Encoding ──

/** Text → URL-safe base64 that survives accents and symbols (UTF-8 first, then base64). */
function encodeBase64Url(plainText: string): string {
  let binaryText = '';
  for (const byte of new TextEncoder().encode(plainText)) binaryText += String.fromCharCode(byte);
  return btoa(binaryText).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe base64 → text; throws on anything that is not valid base64 or UTF-8. */
function decodeBase64Url(encodedText: string): string {
  const standardText = encodedText.replace(/-/g, '+').replace(/_/g, '/');
  const paddedText = standardText + '='.repeat((BASE64_BLOCK_LENGTH - (standardText.length % BASE64_BLOCK_LENGTH)) % BASE64_BLOCK_LENGTH);
  const bytes = Uint8Array.from(atob(paddedText), (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** The payload for one template: only known fields, and only the task templates it links to. */
function buildPayload(template: CrgTemplate, linkedCtaskTemplates: readonly CtaskTemplate[]): SharedTemplatePayload {
  const linkedIds = new Set(template.ctaskTemplateIds ?? []);
  const ctaskTemplates = readSharedTasks(linkedCtaskTemplates.filter((ctaskTemplate) => linkedIds.has(ctaskTemplate.id)));
  return { version: TEMPLATE_SHARE_VERSION, template: readSharedTemplate(template, new Set(ctaskTemplates.map((task) => task.id))), ctaskTemplates };
}

/** One line of text holding the template and its linked tasks, for pasting into Teams or an email. */
export function encodeTemplateShareCode(template: CrgTemplate, linkedCtaskTemplates: readonly CtaskTemplate[]): string {
  return `${TEMPLATE_SHARE_PREFIX}${encodeBase64Url(JSON.stringify(buildPayload(template, linkedCtaskTemplates)))}`;
}

/** The same payload as a downloadable file, named after the template. */
export function buildTemplateShareFile(template: CrgTemplate, linkedCtaskTemplates: readonly CtaskTemplate[]): { fileName: string; blob: Blob } {
  const safeName = template.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || FALLBACK_FILE_NAME;
  const fileText = JSON.stringify(buildPayload(template, linkedCtaskTemplates), null, JSON_INDENT_SPACES);
  return { fileName: `${safeName}${SHARE_FILE_SUFFIX}`, blob: new Blob([fileText], { type: 'application/json' }) };
}

// ── Decoding ──

/** The JSON a pasted code or file holds, or the plain reason it is not one. */
function readShareJson(trimmedText: string): unknown {
  if (trimmedText.startsWith(TEMPLATE_SHARE_PREFIX)) return JSON.parse(decodeBase64Url(trimmedText.slice(TEMPLATE_SHARE_PREFIX.length)));
  if (trimmedText.startsWith(TEMPLATE_SHARE_FAMILY)) throw new TemplateShareFormatError(NEWER_VERSION_MESSAGE);
  if (trimmedText.startsWith('{')) return JSON.parse(trimmedText);
  throw new TemplateShareFormatError(`That is not a template code. A template code starts with ${TEMPLATE_SHARE_PREFIX}`);
}

/** A checked payload from parsed JSON. */
function readPayload(parsedValue: unknown): SharedTemplatePayload {
  if (!isPlainObject(parsedValue)) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  if (parsedValue.version !== TEMPLATE_SHARE_VERSION) throw new TemplateShareFormatError(NEWER_VERSION_MESSAGE);
  const ctaskTemplates = readSharedTasks(parsedValue.ctaskTemplates);
  const template = readSharedTemplate(parsedValue.template, new Set(ctaskTemplates.map((task) => task.id)));
  return { version: TEMPLATE_SHARE_VERSION, template, ctaskTemplates };
}

/** Reads a pasted template code or a template file's text. Never throws: a problem comes back as a plain sentence. */
export function decodeTemplateShare(text: string): TemplateShareDecodeResult {
  const trimmedText = text.trim();
  if (trimmedText === '') return { isValid: false, errorMessage: 'Paste a template code first.' };
  if (trimmedText.length > MAX_SHARE_TEXT_LENGTH) return { isValid: false, errorMessage: 'That is far too long to be a template code.' };
  try {
    return { isValid: true, payload: readPayload(readShareJson(trimmedText)) };
  } catch (unknownError) {
    return { isValid: false, errorMessage: unknownError instanceof TemplateShareFormatError ? unknownError.message : DAMAGED_TEMPLATE_MESSAGE };
  }
}

// ── Importing ──

/** The name itself when free, else "<name> (shared)", "<name> (shared 2)" … — compared ignoring case and spaces. */
export function pickUniqueTemplateName(desiredName: string, existingNames: readonly string[]): string {
  const takenNames = new Set(existingNames.map((existingName) => existingName.trim().toLowerCase()));
  const isFree = (candidateName: string) => !takenNames.has(candidateName.trim().toLowerCase());
  if (isFree(desiredName)) return desiredName;
  const sharedName = `${desiredName} (${SHARED_NAME_SUFFIX})`;
  if (isFree(sharedName)) return sharedName;
  let copyNumber = FIRST_NUMBERED_COPY;
  while (!isFree(`${desiredName} (${SHARED_NAME_SUFFIX} ${copyNumber})`)) copyNumber += 1;
  return `${desiredName} (${SHARED_NAME_SUFFIX} ${copyNumber})`;
}

/** A record's values without its identity, so the store gives it a fresh id. */
function stripIdentity<RecordShape extends { id: string; name: string; createdAt: string }>(record: RecordShape): Omit<RecordShape, 'id' | 'name' | 'createdAt'> {
  const { id: _id, name: _name, createdAt: _createdAt, ...values } = record;
  return values;
}

/**
 * Saves a shared template as the user's own: each task template under a new id, the change template relinked to
 * those new ids and renamed when its name is already taken.
 */
export function importSharedTemplate(payload: SharedTemplatePayload, sinks: TemplateImportSinks): { templateId: string; templateName: string } {
  const newIdBySharedId = new Map<string, string>();
  for (const sharedTask of payload.ctaskTemplates) newIdBySharedId.set(sharedTask.id, sinks.saveCtaskTemplate(sharedTask.name, stripIdentity(sharedTask)));
  const relinkedIds = (payload.template.ctaskTemplateIds ?? []).flatMap((sharedId) => newIdBySharedId.get(sharedId) ?? []);
  const templateName = pickUniqueTemplateName(payload.template.name, sinks.existingTemplateNames);
  const templateId = sinks.saveCrgTemplate(templateName, { ...stripIdentity(payload.template), ctaskTemplateIds: relinkedIds });
  return { templateId, templateName };
}
