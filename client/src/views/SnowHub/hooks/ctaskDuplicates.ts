// ctaskDuplicates.ts — Decides which staged CTASKs still need creating once ServiceNow has already
// made some of them.
//
// ServiceNow auto-spawns an Implementation and a Technical Checkout on a new change. The wizard
// renames those two to the team's convention for THIS change's environment, and then created every
// staged template as a new task on top — so a single PFIX change came back carrying two
// Implementations and two Technical Checkouts, one of the Implementations still naming PRD because
// the staged template had been saved during an earlier release (GH #376).
//
// The environment is exactly the part of an Implementation's name that goes stale, so the
// Implementation is matched on its prefix rather than its full text. Everything else a person staged
// is left alone: a task nobody else created must still be created.

/** A CTASK role ServiceNow auto-creates and the wizard renames in place. */
export type AdoptedCtaskRole = 'implementation' | 'technicalCheckout';

/** The short description the wizard gives an auto-created Technical Checkout. */
const TECHNICAL_CHECKOUT_SHORT_DESCRIPTION = 'Technical Checkout';

/** The fields the duplicate rule reads. Kept minimal so the rule stays testable on its own. */
interface StagedCtaskNaming {
  shortDescription?: string;
  name?: string;
}

/** The text a staged CTASK will actually be created under, lowercased and trimmed for comparison. */
function readComparableShortDescription(stagedTask: StagedCtaskNaming): string {
  return (stagedTask.shortDescription || stagedTask.name || '').trim().toLowerCase();
}

/**
 * Returns the staged CTASKs that still need creating, dropping any that repeat a role ServiceNow
 * already created and the wizard has just renamed.
 *
 * `adoptedRoles` names only what was actually renamed — ServiceNow does not always spawn both — so a
 * Technical Checkout nobody else made is still created. Pure.
 */
export function listStagedCtasksToCreate<StagedTask extends StagedCtaskNaming>(
  stagedTasks: StagedTask[],
  adoptedRoles: AdoptedCtaskRole[],
  implementationPrefix: string,
): StagedTask[] {
  if (adoptedRoles.length === 0) {
    return stagedTasks;
  }

  // An empty prefix is a prefix of everything, which would discard the whole staged list.
  const comparableImplementationPrefix = implementationPrefix.trim().toLowerCase();
  const hasAdoptedImplementation = adoptedRoles.includes('implementation') && comparableImplementationPrefix !== '';
  const hasAdoptedTechnicalCheckout = adoptedRoles.includes('technicalCheckout');

  return stagedTasks.filter((stagedTask) => {
    const comparableShortDescription = readComparableShortDescription(stagedTask);
    if (hasAdoptedImplementation && comparableShortDescription.startsWith(comparableImplementationPrefix)) {
      return false;
    }
    if (hasAdoptedTechnicalCheckout
      && comparableShortDescription === TECHNICAL_CHECKOUT_SHORT_DESCRIPTION.toLowerCase()) {
      return false;
    }
    return true;
  });
}
