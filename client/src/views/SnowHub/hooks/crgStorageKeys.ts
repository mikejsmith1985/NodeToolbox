// crgStorageKeys.ts — Names the localStorage slots that hold Change Request Generator drafts.
//
// The Create wizard has always used one fixed slot. A "rebuild" (feature 033) runs the same
// wizard against a change that already exists, so it needs its own slot per change number —
// otherwise a rebuild would inherit the operator's in-progress Create draft (and so would not
// open blank) and would overwrite it on the first keystroke.

/** The single slot the Create wizard and Configuration mode have always used. */
export const CRG_WIZARD_STORAGE_KEY = 'ntbx-crg-state';

/** Prefix that separates a per-change rebuild draft from the wizard's own draft. */
export const CRG_REBUILD_STORAGE_KEY_PREFIX = 'ntbx-crg-rebuild-state:';

/**
 * Builds the storage slot that holds the rebuild draft for one specific change.
 *
 * The change number is trimmed and upper-cased so "chg0001234" and " CHG0001234 " resolve to the
 * same draft — an operator who retypes the number differently must not lose their work. Because
 * the result always carries the rebuild prefix, it can never collide with the Create wizard's
 * slot, which is what keeps a rebuild bound to the one change it was started from.
 *
 * @param changeNumber - The ServiceNow change number the rebuild will be written to.
 * @returns The localStorage key for that change's rebuild draft.
 */
export function buildRebuildStorageKey(changeNumber: string): string {
  return `${CRG_REBUILD_STORAGE_KEY_PREFIX}${changeNumber.trim().toUpperCase()}`;
}
