// featureStateGates.test.ts — The enterprise Feature workflow, as one rule everything reads.
//
// The guidance is a table on a Confluence page: which fields a Feature must carry to leave each
// state, and what "Done" actually means. Until now every surface that cared re-implemented a bit of
// it — the AI prompts described the format but not the gates, hygiene checked fields without knowing
// which gate wanted them, and nothing at all knew that a Feature deployed to production with the
// value not yet released is "Deployed", never "Done".
//
// So it lives here once. The two things it must get right are the gates themselves, and being
// honest about the several criteria Toolbox cannot see from Jira at all.

import { describe, expect, it } from 'vitest';

import {
  describeEnterpriseFeatureRules,
  describeGateForPrompt,
  evaluateFeatureGate,
  readFeatureState,
  type FeatureGateFacts,
} from './featureStateGates.ts';

/** A Feature satisfying nothing, so each test can turn on exactly the facts it is about. */
function facts(overrides: Partial<FeatureGateFacts> = {}): FeatureGateFacts {
  return {
    hasSummary: false,
    hasReporter: false,
    hasProductOwner: false,
    hasInitiativeType: false,
    hasAssignee: false,
    hasParentLink: false,
    hasEstimate: false,
    hasProgramIncrement: false,
    hasAcceptanceCriteria: false,
    childStoriesWithPointsCount: 0,
    hasTargetStart: false,
    hasTargetEnd: false,
    hasDueDate: false,
    hasFixVersion: false,
    hasApplication: false,
    areAllChildrenClosed: false,
    isCodeInUpperTestRegion: null,
    isCodeInProduction: null,
    haveTestExitCriteriaBeenMet: null,
    areCheckoutActivitiesComplete: null,
    isValueDeliveredToCustomer: null,
    isValueBearing: true,
    ...overrides,
  };
}

describe('readFeatureState', () => {
  it('reads each enterprise state from the status name Jira holds', () => {
    expect(readFeatureState('Funnel')).toBe('funnel');
    expect(readFeatureState('Analyzing')).toBe('analyzing');
    expect(readFeatureState('Ready Backlog')).toBe('ready-backlog');
    expect(readFeatureState('Implementing')).toBe('implementing');
    expect(readFeatureState('Integrated Test')).toBe('integrated-test');
    expect(readFeatureState('Deployed')).toBe('deployed');
    expect(readFeatureState('Done')).toBe('done');
  });

  it('ignores case and surrounding space, which Jira and people both vary', () => {
    expect(readFeatureState('  ready backlog ')).toBe('ready-backlog');
  });

  it('reports a status it does not recognise as unknown rather than guessing a gate', () => {
    // Guessing would produce a confident list of "missing" fields for a state the Feature is not in.
    expect(readFeatureState('In Progress')).toBe('unknown');
    expect(readFeatureState('')).toBe('unknown');
  });
});

describe('the Funnel gate', () => {
  it('names every field the enterprise table requires to reach Analyzing', () => {
    const gate = evaluateFeatureGate('funnel', facts());

    expect(gate.nextState).toBe('analyzing');
    expect(gate.missingRequirements).toEqual([
      'Product Owner', 'Initiative Type', 'Assignee', 'Parent Link (Program Epic)', 'Estimate', 'PI',
    ]);
    expect(gate.canExit).toBe(false);
  });

  it('clears once every one of them is present', () => {
    const gate = evaluateFeatureGate('funnel', facts({
      hasProductOwner: true,
      hasInitiativeType: true,
      hasAssignee: true,
      hasParentLink: true,
      hasEstimate: true,
      hasProgramIncrement: true,
    }));

    expect(gate.missingRequirements).toEqual([]);
    expect(gate.canExit).toBe(true);
  });
});

describe('the Analyzing gate', () => {
  it('wants acceptance criteria, a pointed child story, and both target dates', () => {
    const gate = evaluateFeatureGate('analyzing', facts());

    expect(gate.nextState).toBe('ready-backlog');
    expect(gate.missingRequirements).toEqual([
      'Acceptance Criteria', 'At least one child story with points', 'Target Start', 'Target End',
    ]);
  });

  it('counts a child story only when it carries points', () => {
    // "At least 1 child story with points" — an unpointed child does not satisfy the gate, which is
    // the difference between a Feature that has been broken down and one that has been listed.
    const withUnpointedChildOnly = evaluateFeatureGate('analyzing', facts({
      hasAcceptanceCriteria: true, hasTargetStart: true, hasTargetEnd: true, childStoriesWithPointsCount: 0,
    }));
    expect(withUnpointedChildOnly.missingRequirements).toEqual(['At least one child story with points']);

    const withPointedChild = evaluateFeatureGate('analyzing', facts({
      hasAcceptanceCriteria: true, hasTargetStart: true, hasTargetEnd: true, childStoriesWithPointsCount: 1,
    }));
    expect(withPointedChild.missingRequirements).toEqual([]);
  });
});

describe('the Ready Backlog gate', () => {
  it('wants the due date, the fix version and the CMDB application', () => {
    const gate = evaluateFeatureGate('ready-backlog', facts());

    expect(gate.nextState).toBe('implementing');
    expect(gate.missingRequirements).toEqual(['Due Date', 'Fix Version', 'Application (CMDB)']);
  });
});

describe('the Implementing gate', () => {
  it('wants every child closed and the code in the upper test region', () => {
    const gate = evaluateFeatureGate('implementing', facts());

    expect(gate.nextState).toBe('integrated-test');
    expect(gate.missingRequirements).toContain('All children accepted, done or cancelled');
  });

  it('clears when the children are closed and the deployment is confirmed', () => {
    const gate = evaluateFeatureGate('implementing', facts({
      areAllChildrenClosed: true, isCodeInUpperTestRegion: true,
    }));

    expect(gate.missingRequirements).toEqual([]);
    expect(gate.canExit).toBe(true);
  });
});

describe('what Toolbox cannot see', () => {
  it('reports an unverifiable criterion as unverifiable, never as satisfied', () => {
    // Whether code reached a test region is not in Jira. Treating silence as success would report a
    // Feature as ready to move on the strength of a fact nobody supplied.
    const gate = evaluateFeatureGate('implementing', facts({ areAllChildrenClosed: true }));

    expect(gate.unverifiableRequirements).toContain('Code deployed to upper test region');
    expect(gate.canExit).toBe(false);
  });

  it('keeps unverifiable criteria out of the MISSING list, because they are not known to be absent', () => {
    const gate = evaluateFeatureGate('implementing', facts({ areAllChildrenClosed: true }));
    expect(gate.missingRequirements).toEqual([]);
  });

  it('accepts an explicit false as genuinely missing rather than merely unknown', () => {
    const gate = evaluateFeatureGate('implementing', facts({
      areAllChildrenClosed: true, isCodeInUpperTestRegion: false,
    }));

    expect(gate.missingRequirements).toContain('Code deployed to upper test region');
    expect(gate.unverifiableRequirements).toEqual([]);
  });
});

describe('Deployed is not Done', () => {
  it('holds a Feature at Deployed until the value actually reaches the customer', () => {
    // The distinction the guidance is most explicit about: code in production is NOT delivery.
    const gate = evaluateFeatureGate('deployed', facts({ areCheckoutActivitiesComplete: true, isValueDeliveredToCustomer: false }));

    expect(gate.nextState).toBe('done');
    expect(gate.missingRequirements).toContain('Value delivered to customer');
    expect(gate.canExit).toBe(false);
  });

  it('lets it through once checkout is complete and the value is delivered', () => {
    const gate = evaluateFeatureGate('deployed', facts({
      areCheckoutActivitiesComplete: true, isValueDeliveredToCustomer: true,
    }));

    expect(gate.canExit).toBe(true);
  });

  it('sends Integrated Test to Deployed on production code plus test exit criteria', () => {
    const gate = evaluateFeatureGate('integrated-test', facts());

    expect(gate.nextState).toBe('deployed');
    expect(gate.unverifiableRequirements).toEqual(['Code deployed to Production', 'Test exit criteria met']);
  });
});

describe('a Feature that delivers no value', () => {
  it('is Done once its stories are complete, with no checkout or delivery to wait for', () => {
    // Spikes, testing and deployment Features. Holding them for a customer value that was never the
    // point is how a board fills with work that is finished and cannot be closed.
    const gate = evaluateFeatureGate('implementing', facts({ isValueBearing: false, areAllChildrenClosed: true }));

    expect(gate.nextState).toBe('done');
    expect(gate.missingRequirements).toEqual([]);
    expect(gate.unverifiableRequirements).toEqual([]);
    expect(gate.canExit).toBe(true);
  });

  it('still waits for its stories', () => {
    const gate = evaluateFeatureGate('implementing', facts({ isValueBearing: false }));
    expect(gate.missingRequirements).toEqual(['All children accepted, done or cancelled']);
  });
});

describe('the terminal and unknown states', () => {
  it('asks nothing of a Feature already Done', () => {
    const gate = evaluateFeatureGate('done', facts());
    expect(gate.nextState).toBeNull();
    expect(gate.missingRequirements).toEqual([]);
    expect(gate.canExit).toBe(false);
  });

  it('asks nothing of a status it does not recognise, and says so', () => {
    const gate = evaluateFeatureGate('unknown', facts());
    expect(gate.nextState).toBeNull();
    expect(gate.missingRequirements).toEqual([]);
  });
});

describe('describeGateForPrompt', () => {
  it('tells an assistant which gate the Feature is at and what that gate requires', () => {
    const description = describeGateForPrompt('analyzing');

    expect(description).toContain('Analyzing');
    expect(description).toContain('Ready Backlog');
    expect(description).toContain('Acceptance Criteria');
  });

  it('says nothing at all for a state with no gate, rather than an empty instruction', () => {
    expect(describeGateForPrompt('done')).toBe('');
    expect(describeGateForPrompt('unknown')).toBe('');
  });
});

describe('describeEnterpriseFeatureRules', () => {
  it('states the rule people most often get wrong: production is not delivery', () => {
    const rules = describeEnterpriseFeatureRules();
    expect(rules).toMatch(/Code in production is not delivery/i);
    expect(rules).toMatch(/"Deployed", not "Done"/);
  });

  it('exempts a Feature that was never meant to deliver customer value', () => {
    expect(describeEnterpriseFeatureRules()).toMatch(/spike/i);
  });

  it('lists the fields a Feature carries, so the re-write writes toward them', () => {
    const rules = describeEnterpriseFeatureRules();
    ['Product Owner', 'Parent Link', 'Acceptance Criteria', 'Target Start', 'Fix Version', 'CMDB']
      .forEach((needle) => expect(rules).toContain(needle));
  });

  it('insists a child story carries points, which is the difference from merely listing one', () => {
    expect(describeEnterpriseFeatureRules()).toMatch(/child story WITH points/i);
  });
});

describe('a caller that could not look at everything', () => {
  it('reports a fact it never read as unverifiable, not as missing', () => {
    // The Readiness surface reads Features, not their children, and Jira has no standard field for
    // Initiative Type. Reporting those as MISSING would send a PO to fill in a field that may well
    // already be filled in — the surface simply did not look.
    const gate = evaluateFeatureGate('funnel', facts({
      hasProductOwner: true,
      hasAssignee: true,
      hasParentLink: true,
      hasEstimate: true,
      hasProgramIncrement: true,
      hasInitiativeType: null,
    }));

    expect(gate.missingRequirements).toEqual([]);
    expect(gate.unverifiableRequirements).toEqual(['Initiative Type']);
    expect(gate.canExit).toBe(false);
  });

  it('holds Implementing open when nobody counted the children', () => {
    const gate = evaluateFeatureGate('implementing', facts({
      areAllChildrenClosed: null, isCodeInUpperTestRegion: true,
    }));

    expect(gate.unverifiableRequirements).toEqual(['All children accepted, done or cancelled']);
    expect(gate.canExit).toBe(false);
  });

  it('still counts a fact it DID read and found absent', () => {
    const gate = evaluateFeatureGate('ready-backlog', facts({
      hasDueDate: true, hasFixVersion: false, hasApplication: null,
    }));

    expect(gate.missingRequirements).toEqual(['Fix Version']);
    expect(gate.unverifiableRequirements).toEqual(['Application (CMDB)']);
  });
});
