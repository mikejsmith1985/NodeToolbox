// featureStateGates.ts — The enterprise Feature workflow, encoded once.
//
// The organisation publishes a table: which fields a Feature must carry to leave each state, and
// what "Done" actually means. Every surface that cared was re-deriving a piece of it — the AI
// prompts described the nine-section format but not the gates, hygiene checked fields without
// knowing which gate wanted them, and nothing at all knew that a Feature whose code is in
// production but whose value has not reached the customer is "Deployed", never "Done".
//
// So the table lives here, once, and the prompts and the checks both read it. Two surfaces
// describing one rule from one definition agree by construction; two implementations of it agree
// only until somebody edits one.
//
// FIELD-BLIND BY DESIGN. Nothing here knows a Jira field id or fetches anything. Callers resolve
// their own fields and hand over plain facts, which is what keeps the rule testable with no Jira and
// what keeps this file on the right side of the field-id boundary.

/** The enterprise states a Delivery Feature moves through. */
export type FeatureState =
  | 'funnel'
  | 'analyzing'
  | 'ready-backlog'
  | 'implementing'
  | 'integrated-test'
  | 'deployed'
  | 'done'
  /** A status this table does not describe. Reported, never guessed at. */
  | 'unknown';

/**
 * What a caller has established about one Feature.
 *
 * The booleans are things any caller can answer. The `boolean | null` ones are things a given
 * caller may not have looked at, or that Jira cannot answer at all: whether
 * code actually reached a region, whether checkout happened, whether a customer can use the
 * solution. `null` means "nobody has told us", and it is reported as unverifiable rather than
 * counted either way — a gate that read silence as success would wave through a Feature on the
 * strength of a fact nobody supplied.
 */
export interface FeatureGateFacts {
  hasSummary: boolean;
  hasReporter: boolean;
  hasProductOwner: boolean;
  /** null where the caller has no way to read it — Jira has no standard field for this. */
  hasInitiativeType: boolean | null;
  hasAssignee: boolean;
  hasParentLink: boolean;
  hasEstimate: boolean;
  hasProgramIncrement: boolean;
  hasAcceptanceCriteria: boolean;
  /**
   * Children carrying points. The gate wants at least one; a listed-but-unpointed child is not it.
   *
   * null where the caller did not read the Feature's children — most surfaces read Features alone,
   * and a count of zero would be a confident claim that a broken-down Feature has nothing under it.
   */
  childStoriesWithPointsCount: number | null;
  hasTargetStart: boolean;
  hasTargetEnd: boolean;
  hasDueDate: boolean;
  hasFixVersion: boolean;
  /** The CMDB application. null where the caller does not resolve it. */
  hasApplication: boolean | null;
  /** null where the caller did not read the Feature's children, which is most surfaces. */
  areAllChildrenClosed: boolean | null;
  isCodeInUpperTestRegion: boolean | null;
  isCodeInProduction: boolean | null;
  haveTestExitCriteriaBeenMet: boolean | null;
  areCheckoutActivitiesComplete: boolean | null;
  isValueDeliveredToCustomer: boolean | null;
  /**
   * Whether this Feature exists to deliver customer value.
   *
   * Spikes, testing and deployment Features do not, and the guidance is explicit that they are Done
   * once their stories are complete. Holding them for a delivery that was never the point is how a
   * board fills with work that is finished and cannot be closed.
   */
  isValueBearing: boolean;
}

/** One thing a gate asks for, and how to tell whether this Feature has it. */
interface GateRequirement {
  label: string;
  read: (facts: FeatureGateFacts) => boolean | null;
}

/** What a Feature must satisfy to leave its current state, and what it is short of. */
export interface FeatureGateEvaluation {
  state: FeatureState;
  /** Where satisfying this gate takes it, or null for a terminal or unrecognised state. */
  nextState: FeatureState | null;
  /** Requirements known to be unmet. */
  missingRequirements: string[];
  /** Requirements Toolbox cannot check from Jira — named, so nobody reads their absence as a pass. */
  unverifiableRequirements: string[];
  /** True only when every requirement is positively satisfied. */
  canExit: boolean;
}

/** The status names the enterprise workflow uses, lower-cased for comparison. */
const STATE_BY_STATUS_NAME: Record<string, FeatureState> = {
  funnel: 'funnel',
  analyzing: 'analyzing',
  'ready backlog': 'ready-backlog',
  implementing: 'implementing',
  'integrated test': 'integrated-test',
  deployed: 'deployed',
  done: 'done',
};

/** How each state is written when it is shown to a person or an assistant. */
const STATE_LABELS: Record<FeatureState, string> = {
  funnel: 'Funnel',
  analyzing: 'Analyzing',
  'ready-backlog': 'Ready Backlog',
  implementing: 'Implementing',
  'integrated-test': 'Integrated Test',
  deployed: 'Deployed',
  done: 'Done',
  unknown: 'Unrecognised status',
};

/** Shared by the two gates that end in Done: checkout done, and the customer can actually use it. */
const DELIVERY_REQUIREMENTS: GateRequirement[] = [
  { label: 'Checkout activities complete', read: (facts) => facts.areCheckoutActivitiesComplete },
  { label: 'Value delivered to customer', read: (facts) => facts.isValueDeliveredToCustomer },
];

/** The enterprise table itself: what each state asks for, and where satisfying it leads. */
const GATES: Record<FeatureState, { nextState: FeatureState | null; requirements: GateRequirement[] }> = {
  funnel: {
    nextState: 'analyzing',
    requirements: [
      { label: 'Product Owner', read: (facts) => facts.hasProductOwner },
      { label: 'Initiative Type', read: (facts) => facts.hasInitiativeType },
      { label: 'Assignee', read: (facts) => facts.hasAssignee },
      { label: 'Parent Link (Program Epic)', read: (facts) => facts.hasParentLink },
      { label: 'Estimate', read: (facts) => facts.hasEstimate },
      { label: 'PI', read: (facts) => facts.hasProgramIncrement },
    ],
  },
  analyzing: {
    nextState: 'ready-backlog',
    requirements: [
      { label: 'Acceptance Criteria', read: (facts) => facts.hasAcceptanceCriteria },
      {
        label: 'At least one child story with points',
        read: (facts) => (facts.childStoriesWithPointsCount === null
          ? null
          : facts.childStoriesWithPointsCount > 0),
      },
      { label: 'Target Start', read: (facts) => facts.hasTargetStart },
      { label: 'Target End', read: (facts) => facts.hasTargetEnd },
    ],
  },
  'ready-backlog': {
    nextState: 'implementing',
    requirements: [
      { label: 'Due Date', read: (facts) => facts.hasDueDate },
      { label: 'Fix Version', read: (facts) => facts.hasFixVersion },
      { label: 'Application (CMDB)', read: (facts) => facts.hasApplication },
    ],
  },
  implementing: {
    // Integrated Test is where a Feature that will be tested in an upper region goes next. The
    // guidance calls it optional; a Feature may go straight to Deployed or Done instead, which is a
    // routing decision the team makes, not one a gate should make for them.
    nextState: 'integrated-test',
    requirements: [
      { label: 'All children accepted, done or cancelled', read: (facts) => facts.areAllChildrenClosed },
      { label: 'Code deployed to upper test region', read: (facts) => facts.isCodeInUpperTestRegion },
    ],
  },
  'integrated-test': {
    nextState: 'deployed',
    requirements: [
      { label: 'Code deployed to Production', read: (facts) => facts.isCodeInProduction },
      { label: 'Test exit criteria met', read: (facts) => facts.haveTestExitCriteriaBeenMet },
    ],
  },
  deployed: {
    nextState: 'done',
    requirements: DELIVERY_REQUIREMENTS,
  },
  done: { nextState: null, requirements: [] },
  unknown: { nextState: null, requirements: [] },
};

/**
 * The gate a Feature that delivers no value follows out of Implementing.
 *
 * Its stories still have to be finished; nothing beyond that applies, because there is no value to
 * deliver and no checkout to run.
 */
const VALUE_LESS_IMPLEMENTING_GATE: { nextState: FeatureState; requirements: GateRequirement[] } = {
  nextState: 'done',
  requirements: [
    { label: 'All children accepted, done or cancelled', read: (facts) => facts.areAllChildrenClosed },
  ],
};

/** Reads Jira's status name as an enterprise state, or `unknown` when the table does not cover it. */
export function readFeatureState(statusName: string): FeatureState {
  return STATE_BY_STATUS_NAME[statusName.trim().toLowerCase()] ?? 'unknown';
}

/**
 * Works out what one Feature still needs to leave the state it is in.
 *
 * Splits what is MISSING from what cannot be CHECKED, because those call for different actions: one
 * is a field somebody fills in, the other a fact somebody confirms. Collapsing them would make a
 * Feature waiting on a deployment look identical to one waiting on a due date.
 */
export function evaluateFeatureGate(state: FeatureState, facts: FeatureGateFacts): FeatureGateEvaluation {
  const gate = state === 'implementing' && !facts.isValueBearing
    ? VALUE_LESS_IMPLEMENTING_GATE
    : GATES[state];

  const missingRequirements: string[] = [];
  const unverifiableRequirements: string[] = [];
  gate.requirements.forEach((requirement) => {
    const isSatisfied = requirement.read(facts);
    if (isSatisfied === null) {
      unverifiableRequirements.push(requirement.label);
    } else if (!isSatisfied) {
      missingRequirements.push(requirement.label);
    }
  });

  return {
    state,
    nextState: gate.nextState,
    missingRequirements,
    unverifiableRequirements,
    // A terminal state can never "exit", and an unverifiable requirement is not a pass.
    canExit: gate.nextState !== null
      && missingRequirements.length === 0
      && unverifiableRequirements.length === 0,
  };
}

/**
 * Describes a state's gate for an AI prompt.
 *
 * Read from the same table the checks use, so an assistant is told to write toward exactly the
 * criteria the Feature will later be measured against. Empty for a state with no gate — an
 * instruction with nothing in it is worse than no instruction, because it still costs attention.
 */
export function describeGateForPrompt(state: FeatureState): string {
  const gate = GATES[state];
  if (gate.nextState === null || gate.requirements.length === 0) {
    return '';
  }
  const requirementLabels = gate.requirements.map((requirement) => requirement.label).join(', ');
  return `This Feature is in "${STATE_LABELS[state]}". To reach "${STATE_LABELS[gate.nextState]}" it must have: `
    + `${requirementLabels}. Write the re-write so those criteria are satisfied or clearly flagged as missing.`;
}

/**
 * The enterprise Feature rules, compact enough to ride in every prompt.
 *
 * Both the composition and the batch re-write carry this, so an assistant writes toward the same
 * criteria the Feature is later measured against. Stating the Deployed-versus-Done distinction is
 * the load-bearing part: it is the rule people most often get wrong, and the one that turns a board
 * full of "Done" Features into a report nobody trusts.
 */
export function describeEnterpriseFeatureRules(): string {
  return [
    'Enterprise Feature rules this organisation works to:',
    '- A Feature is DONE only when all stories are complete, checkout activities are complete, AND the',
    '  customer can actually use the solution. Code in production is not delivery.',
    '- Deployed to production but the value not yet released to the customer is "Deployed", not "Done".',
    '- A Feature that delivers no customer value (a spike, a test, a deployment) is Done once its',
    '  stories are complete.',
    '- A Feature carries: Product Owner, Initiative Type, Assignee, Parent Link (Program Epic),',
    '  Estimate, PI, Acceptance Criteria, at least one child story WITH points, Target Start,',
    '  Target End, Due Date, Fix Version and the CMDB Application.',
    'Write so these are satisfied where the material supports it, and flagged where it does not.',
  ].join('\n');
}
