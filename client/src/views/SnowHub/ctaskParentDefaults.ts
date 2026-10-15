// ctaskParentDefaults.ts — What a CTASK inherits from the change it belongs to: the CI, and a window inside the change's.
//
// A CTASK's configuration item is always the change's, so it is copied from the change rather than typed per task.
// Its planned dates come from the template only when they sit inside the change's own window. Templates are
// reused, so their stored dates usually belong to an earlier change; sending them made CTASKs that ran days or
// months away from the change they were part of. A template therefore carries its timing as minutes after the
// change starts and a duration, placed onto each change it is used on. Every date here is in the form's local
// datetime-local shape.

import { formatMinutes } from './ctaskDurations.ts';

/** The facts a new CTASK takes from its change. Empty strings mean the change does not carry that fact. */
export interface ChangeTaskDefaults {
  configItemSysId: string;
  plannedStartDate: string;
  plannedEndDate: string;
}

/** No defaults: the CTASK is sent with only what its own template carries. */
export const EMPTY_CHANGE_TASK_DEFAULTS: ChangeTaskDefaults = Object.freeze({
  configItemSysId: '',
  plannedStartDate: '',
  plannedEndDate: '',
});

/** A CTASK's planned window. */
export interface CtaskPlannedWindow {
  plannedStartDate: string;
  plannedEndDate: string;
}

/** A template's timing relative to its change, as typed minutes (blank = not set). */
export interface CtaskTimingOffsets {
  /** Minutes after the change starts that the CTASK starts; blank starts it with the change. */
  startOffsetMinutes?: string;
  /** How long the CTASK runs; blank runs it to the end of the change. */
  durationMinutes?: string;
}

const MILLISECONDS_PER_MINUTE = 60_000;

/** A typed whole number of minutes, or null when blank or not a usable number. */
function readMinutes(typedMinutes: string | undefined): number | null {
  const trimmedMinutes = (typedMinutes ?? '').trim();
  if (trimmedMinutes === '') return null;
  const parsedMinutes = Number(trimmedMinutes);
  return Number.isFinite(parsedMinutes) && parsedMinutes >= 0 ? Math.round(parsedMinutes) : null;
}

/** An instant as the `YYYY-MM-DDTHH:mm` a datetime-local input holds, in local time. */
function formatLocalDateTime(instantMilliseconds: number): string {
  const instant = new Date(instantMilliseconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`
    + `T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

/** True when the template carries any timing of its own. */
function hasTimingOffsets(timing: CtaskTimingOffsets): boolean {
  return readMinutes(timing.startOffsetMinutes) !== null || readMinutes(timing.durationMinutes) !== null;
}

/** The template's timing placed onto the change's window, never running past the change's end. */
function placeTimingInChange(timing: CtaskTimingOffsets, changeStart: number, changeEnd: number): CtaskPlannedWindow {
  const taskStart = Math.min(changeStart + (readMinutes(timing.startOffsetMinutes) ?? 0) * MILLISECONDS_PER_MINUTE, changeEnd);
  const durationMinutes = readMinutes(timing.durationMinutes);
  const taskEnd = durationMinutes === null ? changeEnd : Math.min(taskStart + durationMinutes * MILLISECONDS_PER_MINUTE, changeEnd);
  return { plannedStartDate: formatLocalDateTime(taskStart), plannedEndDate: formatLocalDateTime(taskEnd) };
}

/** "Starts 30 minutes after the change starts · runs 1 hour" — a template's timing for the template list. */
export function describeCtaskTiming(timing: CtaskTimingOffsets): string {
  if (!hasTimingOffsets(timing)) return "Spans the change's full window";
  const startOffset = readMinutes(timing.startOffsetMinutes);
  const durationMinutes = readMinutes(timing.durationMinutes);
  const startText = startOffset ? `Starts ${formatMinutes(startOffset)} after the change starts` : 'Starts with the change';
  const runText = durationMinutes === null ? "runs to the change's end" : `runs ${formatMinutes(durationMinutes)}`;
  return `${startText} · ${runText}`;
}

/** The instant a local datetime-local value names, or NaN when it names none. */
function readLocalInstant(localDateTime: string): number {
  return localDateTime.trim() === '' ? Number.NaN : Date.parse(localDateTime);
}

/** True when the CTASK's own window is complete and lies within the change's window. */
function isWindowInsideChange(ctaskWindow: CtaskPlannedWindow, changeWindow: CtaskPlannedWindow): boolean {
  const ctaskStart = readLocalInstant(ctaskWindow.plannedStartDate);
  const ctaskEnd = readLocalInstant(ctaskWindow.plannedEndDate);
  if (Number.isNaN(ctaskStart) || Number.isNaN(ctaskEnd)) {
    return false;
  }
  return ctaskStart >= readLocalInstant(changeWindow.plannedStartDate) && ctaskEnd <= readLocalInstant(changeWindow.plannedEndDate);
}

/**
 * The planned window a CTASK is created with, in order of preference: dates set on the task itself when they
 * fall inside the change's window; then the template's timing placed onto the change; then the change's whole
 * window. When the change's window is not known, the task's own dates are all there is, so they are kept.
 */
export function resolveCtaskPlannedWindow(
  ctaskWindow: CtaskPlannedWindow & CtaskTimingOffsets,
  defaults: ChangeTaskDefaults,
): CtaskPlannedWindow {
  const changeWindow = { plannedStartDate: defaults.plannedStartDate, plannedEndDate: defaults.plannedEndDate };
  const isChangeWindowKnown = !Number.isNaN(readLocalInstant(changeWindow.plannedStartDate))
    && !Number.isNaN(readLocalInstant(changeWindow.plannedEndDate));
  if (!isChangeWindowKnown || isWindowInsideChange(ctaskWindow, changeWindow)) {
    return { plannedStartDate: ctaskWindow.plannedStartDate, plannedEndDate: ctaskWindow.plannedEndDate };
  }
  if (hasTimingOffsets(ctaskWindow)) {
    return placeTimingInChange(ctaskWindow, readLocalInstant(changeWindow.plannedStartDate), readLocalInstant(changeWindow.plannedEndDate));
  }
  return changeWindow;
}
