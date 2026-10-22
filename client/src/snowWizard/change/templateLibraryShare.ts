// templateLibraryShare.ts — Moves every saved template at once — all change templates and all task templates — from
// Toolbox to the SNow Wizard as one code or file, and safely back into the Wizard's own stores.
//
// Toolbox and the Wizard keep templates in separate browser storage (the Wizard runs inside ServiceNow's site), so text
// the user copies or a file they download is the only way across. Both sides use this one module, so they can never
// disagree about the format. Each value is checked by the same field-by-field reader a single shared template uses.

import { decodeBase64Url, encodeBase64Url } from '../../views/SnowHub/ctaskTemplateShare.ts';
import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { pickUniqueTemplateName, type TemplateImportSinks } from './templateShare.ts';
import {
  DAMAGED_TEMPLATE_MESSAGE, TemplateShareFormatError, isPlainObject, readSharedTasks, readSharedTemplate,
} from './templateShareFormat.ts';

/** The start of every whole-library code; the number is the format version. */
export const TEMPLATE_LIBRARY_PREFIX = 'SNOWWIZ-LIBRARY-1:';
const TEMPLATE_LIBRARY_FAMILY = 'SNOWWIZ-LIBRARY-';
const TEMPLATE_LIBRARY_VERSION = 1;
// Marks a library file's JSON, so it is never mistaken for a single template's file.
const TEMPLATE_LIBRARY_KIND = 'templateLibrary';
/** The name a downloaded library file is saved under. */
export const TEMPLATE_LIBRARY_FILE_NAME = 'all-templates.snow-library.json';
// Far above any real library (Toolbox keeps at most 20 change templates and 100 task templates).
const MAX_SHARE_TEXT_LENGTH = 5_000_000;
const MAX_SHARED_TEMPLATES = 200;
const JSON_INDENT_SPACES = 2;
const FALLBACK_TASK_NAME = 'Task';
const NEWER_VERSION_MESSAGE = 'These templates were exported from a newer version. Update the Wizard, then try again.';
const NOT_A_LIBRARY_MESSAGE = `That is not an "all templates" code. It starts with ${TEMPLATE_LIBRARY_PREFIX}`;
const TOO_MANY_TEMPLATES_MESSAGE = 'This holds more templates than the Wizard can keep. Export fewer.';
const LIBRARY_KIND_PATTERN = /"kind"\s*:\s*"templateLibrary"/;

/** What a whole-library code or file carries. */
export interface SharedTemplateLibraryPayload {
  version: typeof TEMPLATE_LIBRARY_VERSION;
  kind: typeof TEMPLATE_LIBRARY_KIND;
  templates: CrgTemplate[];
  ctaskTemplates: CtaskTemplate[];
}

/** One export, ready as a code to copy and as a file to download. */
export interface TemplateLibraryExport {
  code: string;
  file: { fileName: string; blob: Blob };
  templateCount: number;
  taskCount: number;
  /** Templates too damaged to carry, named so nobody wonders where they went. */
  leftOutNames: string[];
}

/** A read library code: the templates, or the plain reason they cannot be used. */
export type TemplateLibraryDecodeResult = { isValid: true; payload: SharedTemplateLibraryPayload } | { isValid: false; errorMessage: string };

// ── Exporting (Toolbox side) ──

/** Each task checked on its own, so one odd old task cannot stop the rest travelling. */
function readEachTask(ctaskTemplates: readonly CtaskTemplate[], leftOutNames: string[]): CtaskTemplate[] {
  return ctaskTemplates.flatMap((task) => {
    const namedTask = { ...task, name: task.name.trim() || task.shortDescription.trim() || FALLBACK_TASK_NAME };
    try {
      return readSharedTasks([namedTask]);
    } catch {
      leftOutNames.push(namedTask.name);
      return [];
    }
  });
}

/** Each change template checked on its own, keeping only links to tasks that travel. */
function readEachTemplate(templates: readonly CrgTemplate[], taskIds: ReadonlySet<string>, leftOutNames: string[]): CrgTemplate[] {
  return templates.flatMap((template) => {
    try {
      return [readSharedTemplate(template, taskIds)];
    } catch {
      leftOutNames.push(template.name || 'A template with no name');
      return [];
    }
  });
}

/** Every change template and task template as one code and one file; anything too damaged to carry is named. */
export function prepareTemplateLibraryExport(templates: readonly CrgTemplate[], ctaskTemplates: readonly CtaskTemplate[]): TemplateLibraryExport {
  const leftOutNames: string[] = [];
  const sharedTasks = readEachTask(ctaskTemplates, leftOutNames);
  const sharedTemplates = readEachTemplate(templates, new Set(sharedTasks.map((task) => task.id)), leftOutNames);
  const payload: SharedTemplateLibraryPayload = {
    version: TEMPLATE_LIBRARY_VERSION, kind: TEMPLATE_LIBRARY_KIND, templates: sharedTemplates, ctaskTemplates: sharedTasks,
  };
  const fileText = JSON.stringify(payload, null, JSON_INDENT_SPACES);
  return {
    code: `${TEMPLATE_LIBRARY_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`,
    file: { fileName: TEMPLATE_LIBRARY_FILE_NAME, blob: new Blob([fileText], { type: 'application/json' }) },
    templateCount: sharedTemplates.length,
    taskCount: sharedTasks.length,
    leftOutNames,
  };
}

// ── Reading (Wizard side) ──

/** Whether pasted text or a file's text is a whole-library export (rather than one template or a task code). */
export function isTemplateLibraryShareText(text: string): boolean {
  const trimmedText = text.trim();
  return trimmedText.startsWith(TEMPLATE_LIBRARY_FAMILY) || (trimmedText.startsWith('{') && LIBRARY_KIND_PATTERN.test(trimmedText));
}

function readLibraryJson(trimmedText: string): unknown {
  if (trimmedText.startsWith(TEMPLATE_LIBRARY_PREFIX)) return JSON.parse(decodeBase64Url(trimmedText.slice(TEMPLATE_LIBRARY_PREFIX.length)));
  if (trimmedText.startsWith(TEMPLATE_LIBRARY_FAMILY)) throw new TemplateShareFormatError(NEWER_VERSION_MESSAGE);
  if (trimmedText.startsWith('{')) return JSON.parse(trimmedText);
  throw new TemplateShareFormatError(NOT_A_LIBRARY_MESSAGE);
}

function readLibraryPayload(parsedValue: unknown): SharedTemplateLibraryPayload {
  if (!isPlainObject(parsedValue) || parsedValue.kind !== TEMPLATE_LIBRARY_KIND) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  if (parsedValue.version !== TEMPLATE_LIBRARY_VERSION) throw new TemplateShareFormatError(NEWER_VERSION_MESSAGE);
  if (!Array.isArray(parsedValue.templates)) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  if (parsedValue.templates.length > MAX_SHARED_TEMPLATES) throw new TemplateShareFormatError(TOO_MANY_TEMPLATES_MESSAGE);
  const ctaskTemplates = readSharedTasks(parsedValue.ctaskTemplates);
  const taskIds = new Set(ctaskTemplates.map((task) => task.id));
  const templates = parsedValue.templates.map((template) => readSharedTemplate(template, taskIds));
  return { version: TEMPLATE_LIBRARY_VERSION, kind: TEMPLATE_LIBRARY_KIND, templates, ctaskTemplates };
}

/** Reads a pasted library code or a library file's text. Never throws: a problem comes back as a plain sentence. */
export function decodeTemplateLibraryShare(text: string): TemplateLibraryDecodeResult {
  const trimmedText = text.trim();
  if (trimmedText.length > MAX_SHARE_TEXT_LENGTH) return { isValid: false, errorMessage: 'That is far too long to be a template export.' };
  try {
    return { isValid: true, payload: readLibraryPayload(readLibraryJson(trimmedText)) };
  } catch (unknownError) {
    return { isValid: false, errorMessage: unknownError instanceof TemplateShareFormatError ? unknownError.message : DAMAGED_TEMPLATE_MESSAGE };
  }
}

// ── Importing (Wizard side) ──

/** Where a library import saves to, what is already there, and how much room the stores have left. */
export interface LibraryImportSinks extends Omit<TemplateImportSinks, 'existingTemplateNames'> {
  existingTemplateNames: readonly string[];
  existingTasks: ReadonlyArray<{ id: string; name: string }>;
  /** How many more change templates fit before the store starts dropping its oldest. */
  templateRoom: number;
  taskRoom: number;
}

/** What an import did, name by name. */
export interface LibraryImportOutcome {
  addedTemplateNames: string[];
  addedTaskNames: string[];
  alreadyThereTemplateNames: string[];
  alreadyThereTaskNames: string[];
  noRoomTemplateNames: string[];
  noRoomTaskNames: string[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** A record's values without its identity, so the store gives it a fresh id. */
function stripIdentity<RecordShape extends { id: string; name: string; createdAt: string }>(record: RecordShape): Omit<RecordShape, 'id' | 'name' | 'createdAt'> {
  const { id: _id, name: _name, createdAt: _createdAt, ...values } = record;
  return values;
}

/** Decides which shared tasks to add, reuse (same name already in the Wizard) or leave out for lack of room. */
function planTasks(sharedTasks: readonly CtaskTemplate[], sinks: LibraryImportSinks, outcome: LibraryImportOutcome) {
  const existingIdByName = new Map(sinks.existingTasks.map((task) => [nameKey(task.name), task.id]));
  const reusedIdBySharedId = new Map<string, string>();
  const tasksToAdd: Array<{ sharedTask: CtaskTemplate; name: string }> = [];
  const takenNames = sinks.existingTasks.map((task) => task.name);
  for (const sharedTask of sharedTasks) {
    const existingId = existingIdByName.get(nameKey(sharedTask.name));
    if (existingId) {
      reusedIdBySharedId.set(sharedTask.id, existingId);
      outcome.alreadyThereTaskNames.push(sharedTask.name);
    } else if (tasksToAdd.length < sinks.taskRoom) {
      // Two tasks of the same name in one export stay two tasks.
      const name = pickUniqueTemplateName(sharedTask.name, takenNames);
      takenNames.push(name);
      tasksToAdd.push({ sharedTask, name });
    } else {
      outcome.noRoomTaskNames.push(sharedTask.name);
    }
  }
  return { reusedIdBySharedId, tasksToAdd };
}

/**
 * Saves a whole exported library as the user's own. A template or task whose name the Wizard already has is left
 * alone (so importing twice adds nothing twice); templates link to the Wizard's same-named task; and nothing is saved
 * past the stores' limits, because a save there quietly drops the oldest template.
 */
export function importSharedLibrary(payload: SharedTemplateLibraryPayload, sinks: LibraryImportSinks): LibraryImportOutcome {
  const outcome: LibraryImportOutcome = {
    addedTemplateNames: [], addedTaskNames: [], alreadyThereTemplateNames: [], alreadyThereTaskNames: [], noRoomTemplateNames: [], noRoomTaskNames: [],
  };
  const { reusedIdBySharedId, tasksToAdd } = planTasks(payload.ctaskTemplates, sinks, outcome);
  const existingTemplateNames = new Set(sinks.existingTemplateNames.map(nameKey));
  const templatesToAdd: CrgTemplate[] = [];
  for (const template of payload.templates) {
    if (existingTemplateNames.has(nameKey(template.name))) outcome.alreadyThereTemplateNames.push(template.name);
    else if (templatesToAdd.length < sinks.templateRoom) templatesToAdd.push(template);
    else outcome.noRoomTemplateNames.push(template.name);
  }
  // Each save goes to the top of its list, so saving last-first leaves the list in the exported order.
  const newIdBySharedId = new Map(reusedIdBySharedId);
  for (const { sharedTask, name } of [...tasksToAdd].reverse()) newIdBySharedId.set(sharedTask.id, sinks.saveCtaskTemplate(name, stripIdentity(sharedTask)));
  for (const template of [...templatesToAdd].reverse()) {
    const relinkedIds = (template.ctaskTemplateIds ?? []).flatMap((sharedId) => newIdBySharedId.get(sharedId) ?? []);
    sinks.saveCrgTemplate(template.name, { ...stripIdentity(template), ctaskTemplateIds: relinkedIds });
  }
  outcome.addedTaskNames = tasksToAdd.map((task) => task.name);
  outcome.addedTemplateNames = templatesToAdd.map((template) => template.name);
  return outcome;
}
