// dorCriteria.ts — The team's Definition of Ready and Definition of Done, as the validator's fallback rubric.
//
// The Epic's own Smart Checklist is always preferred: it is what the team actually agreed and what Jira shows.
// But on this instance the checklist arrives from a LINKED template (CUC - DoR / CUC - DoD), and a linked
// template's items are not always readable as text on the issue itself. When they cannot be read, a validator
// that shrugs is useless — the criteria are the same criteria whether or not Jira will hand them over, so they
// are written out here and the report says which source it used.
//
// Keep these in step with the Jira templates. They are a fallback, never the authority.

/** Which definition a criterion belongs to. A PO validates one or the other, rarely both at once. */
export type ReadinessDefinition = 'dor' | 'dod';

/** One thing an Epic has to satisfy. */
export interface ReadinessCriterion {
  /** Stable id the assistant quotes back. Never a line number, so it survives the checklist being unreadable. */
  id: string;
  definition: ReadinessDefinition;
  /** The group header it sits under in the template, e.g. "Business Readiness". */
  section: string;
  /** The criterion itself, in the template's own words. */
  text: string;
}

/** The team's Definition of Ready, as the CUC - DoR checklist template states it. */
export const DEFAULT_DOR_CRITERIA: ReadinessCriterion[] = [
  {
    id: 'dor-business-objective',
    definition: 'dor',
    section: 'Business Readiness',
    text: 'Business objective, success criteria, and stakeholder alignment are established',
  },
  {
    id: 'dor-scope-and-ac',
    definition: 'dor',
    section: 'Requirements Readiness',
    text: 'Scope and acceptance criteria are understood',
  },
  {
    id: 'dor-dependencies',
    definition: 'dor',
    section: 'Dependency Readiness',
    text: 'Major dependencies are identified',
  },
  {
    id: 'dor-solution-and-risks',
    definition: 'dor',
    section: 'Technical Readiness',
    text: 'Solution approach is understood and major risks are identified',
  },
  {
    id: 'dor-access-environments',
    definition: 'dor',
    section: 'Technical Readiness',
    text: 'Required access/environments are available',
  },
  {
    id: 'dor-team-commitment',
    definition: 'dor',
    section: 'Team Commitment',
    text: 'Team agrees work can begin without significant discovery',
  },
];

/** The team's Definition of Done, as the CUC - DoD checklist template states it. */
export const DEFAULT_DOD_CRITERIA: ReadinessCriterion[] = [
  {
    id: 'dod-outcome-achieved',
    definition: 'dod',
    section: 'Outcome Achieved',
    text: 'Business objective and success criteria have been achieved',
  },
  {
    id: 'dod-scope-complete',
    definition: 'dod',
    section: 'Scope Complete',
    text: 'Planned scope is completed or intentionally dispositioned',
  },
  {
    id: 'dod-validation-complete',
    definition: 'dod',
    section: 'Validation Complete',
    text: 'Stakeholders have reviewed and accepted the delivered outcome',
  },
  {
    id: 'dod-operational-readiness',
    definition: 'dod',
    section: 'Operational Readiness',
    text: 'Required documentation and support activities are complete',
  },
  {
    id: 'dod-closure-decision',
    definition: 'dod',
    section: 'Closure Decision',
    text: 'Epic meets Definition of Done',
  },
];

/** Both definitions, in the order a PO walks them. */
export const DEFAULT_READINESS_CRITERIA: ReadinessCriterion[] = [...DEFAULT_DOR_CRITERIA, ...DEFAULT_DOD_CRITERIA];

/** How the criteria being validated were obtained — stated on the report so nobody guesses. */
export type CriteriaSource = 'issueChecklist' | 'standardTemplate';

/** What each definition is called on screen and in the report. */
export const DEFINITION_LABELS: Record<ReadinessDefinition, string> = {
  dor: 'Definition of Ready',
  dod: 'Definition of Done',
};

/**
 * Works out which definition a checklist item belongs to from the header it sits under.
 *
 * The team's checklist puts every item under "Definition of Ready (DoR)" or "Definition of Done (DoD)", but the
 * item's own nearest header is its group ("Business Readiness"), so the definition is read from the whole text
 * above it. Anything that names neither is treated as Definition of Ready: an unclassified criterion should be
 * checked before work starts rather than quietly deferred to the end.
 */
export function readDefinitionFromHeading(headingText: string): ReadinessDefinition {
  return /\bdod\b|definition of done/i.test(headingText) ? 'dod' : 'dor';
}

/** The criteria being validated, and where they came from. */
export interface ResolvedCriteria {
  criteria: ReadinessCriterion[];
  source: CriteriaSource;
}

/**
 * Turns the Epic's own checklist items into criteria, falling back to the standard template when there are none.
 *
 * Preferring the issue's checklist matters: it is what the team agreed, in their words, and a criterion built
 * from an item keeps the item's id, so a satisfied criterion can still be ticked afterwards. The fallback is what
 * keeps the validator useful on this instance, where the checklist arrives from a linked template and is not
 * always readable as text on the issue.
 */
export function resolveCriteria(
  checklistItems: readonly { id: string; text: string; section: string; definitionHeading: string }[],
): ResolvedCriteria {
  if (checklistItems.length === 0) {
    return { criteria: [...DEFAULT_READINESS_CRITERIA], source: 'standardTemplate' };
  }

  return {
    criteria: checklistItems.map((checklistItem) => ({
      id: checklistItem.id,
      definition: readDefinitionFromHeading(checklistItem.definitionHeading),
      section: checklistItem.section,
      text: checklistItem.text,
    })),
    source: 'issueChecklist',
  };
}
