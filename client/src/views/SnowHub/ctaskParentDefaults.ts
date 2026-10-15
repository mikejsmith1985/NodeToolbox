// ctaskParentDefaults.ts — What a CTASK inherits from the change it belongs to: the CI, and a window inside the change's.
//
// A CTASK's configuration item is always the change's, so it is copied from the change rather than typed per task.
// Its planned dates come from the template only when they sit inside the change's own window. Templates are
// reused, so their stored dates usually belong to an earlier change; sending them made CTASKs that ran days or
// months away from the change they were part of. Every date here is in the form's local datetime-local shape.

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
 * The planned window a CTASK is created with. The template's own dates are kept when they fall inside the
 * change's window; otherwise the CTASK takes the change's window. When the change's window is not known,
 * the template's dates are all there is, so they are kept as they are.
 */
export function resolveCtaskPlannedWindow(ctaskWindow: CtaskPlannedWindow, defaults: ChangeTaskDefaults): CtaskPlannedWindow {
  const changeWindow = { plannedStartDate: defaults.plannedStartDate, plannedEndDate: defaults.plannedEndDate };
  const isChangeWindowKnown = !Number.isNaN(readLocalInstant(changeWindow.plannedStartDate))
    && !Number.isNaN(readLocalInstant(changeWindow.plannedEndDate));
  if (!isChangeWindowKnown || isWindowInsideChange(ctaskWindow, changeWindow)) {
    return { plannedStartDate: ctaskWindow.plannedStartDate, plannedEndDate: ctaskWindow.plannedEndDate };
  }
  return changeWindow;
}
