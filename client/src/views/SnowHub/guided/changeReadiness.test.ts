// changeReadiness.test.ts — The change readiness engine: every item rule, the could-not-check rule, and the ready rule.

import { describe, expect, it } from 'vitest';

import type { ChgTextFieldKey } from '../chgFormula/formulaCard.ts';
import type { RcpCheckResult } from '../rcp/rcpRules.ts';
import {
  buildChangeReadiness,
  isChangeEditable,
  isReady,
  READINESS_ITEM_IDS,
  type ChangeReadinessFacts,
  type ReadinessItem,
  type ReadinessItemId,
} from './changeReadiness.ts';

// Internal ServiceNow / Jira field names the Wizard's copy scan rejects in anything a person can see.
const INTERNAL_FIELD_NAME_PATTERN = /u_[a-z]|cmdb_ci|customfield_|sys_id/;

const COMPLETE_TEXT_FIELDS: Record<ChgTextFieldKey, string> = {
  shortDescription: 'Recon | deploy v1.5 | PRD',
  description: 'Deploys the reconciliation service v1.5 to Production.',
  justification: 'Fixes premium rounding before month end.',
  riskImpact: 'Moderate risk; reconciliation only.',
  implementationPlan: '1. Deploy v1.5. 2. Restart the service.',
  testPlan: 'Tested in INT; success = all batches balance.',
  backoutPlan: 'Redeploy v1.4 within 30 minutes.',
};

const PASSING_RCP_CHECKS: RcpCheckResult[] = [
  { ruleId: 'window', title: 'Approved window', status: 'pass', detail: 'Friday night.' },
  { ruleId: 'approval', title: 'Director approval attached', status: 'pass', detail: 'Attached.' },
];

/** Facts for a Production change that meets every rule. */
function buildReadyFacts(overrides: Partial<ChangeReadinessFacts> = {}): ChangeReadinessFacts {
  return {
    change: { changeNumber: 'CHG0012345', stateLabel: 'New', ownerName: 'Lee, Jordan', configItemName: 'Recon Service' },
    textFields: { ...COMPLETE_TEXT_FIELDS },
    isProduction: true,
    plannedWindow: { plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z' },
    riskReview: { isReady: true },
    isRcpActive: true,
    rcpChecks: PASSING_RCP_CHECKS,
    outageCount: 1,
    ctasks: [
      { number: 'CTASK1', isImplementation: true, isConfigItemMatching: true, hasBackoutPlan: true, hasPlannedDates: true },
      { number: 'CTASK2', isImplementation: false, isConfigItemMatching: true, hasBackoutPlan: false, hasPlannedDates: true },
    ],
    prbs: [{ prbNumber: 'PRB0001', linkStatus: 'thisChange' }],
    attachmentFileNames: ['evidence.zip'],
    failureReasons: {},
    ...overrides,
  };
}

/** The one item with this id. */
function findItem(items: readonly ReadinessItem[], itemId: ReadinessItemId): ReadinessItem {
  const matchingItem = items.find((item) => item.id === itemId);
  if (!matchingItem) throw new Error(`no item ${itemId}`);
  return matchingItem;
}

/** The item with this id, built from the ready facts with these overrides. */
function readItem(itemId: ReadinessItemId, overrides: Partial<ChangeReadinessFacts>): ReadinessItem {
  return findItem(buildChangeReadiness(buildReadyFacts(overrides)), itemId);
}

/** Every fact the engine reads, set to "could not be read". */
const ALL_NULL_FACTS: Partial<ChangeReadinessFacts> = {
  change: null, textFields: null, isProduction: null, plannedWindow: null, rcpChecks: null,
  outageCount: null, ctasks: null, prbs: null, attachmentFileNames: null,
};

describe('buildChangeReadiness — shape', () => {
  it('returns one item per id, in the fixed order', () => {
    const items = buildChangeReadiness(buildReadyFacts());
    expect(items.map((item) => item.id)).toEqual([...READINESS_ITEM_IDS]);
  });

  it('lists the 039 items first, then the Formula Card sections 1-7', () => {
    expect(READINESS_ITEM_IDS).toEqual([
      'owner', 'riskCheck', 'rcp', 'outage', 'ctaskCi', 'ctaskBackout', 'ctaskDates', 'prbs', 'testEvidence',
      'formulaIdentity', 'formulaBusinessNeed', 'formulaRisk', 'formulaSchedule', 'formulaImplementation',
      'formulaTesting', 'formulaBackout',
    ]);
  });

  it('marks every item done for a change that meets every rule', () => {
    const items = buildChangeReadiness(buildReadyFacts());
    expect(items.filter((item) => item.state !== 'done')).toEqual([]);
    expect(isReady(items)).toBe(true);
  });

  it('gives every item a plain label and reason', () => {
    const items = buildChangeReadiness(buildReadyFacts());
    for (const item of items) {
      expect(item.label.trim()).not.toBe('');
      expect(item.reason.trim()).not.toBe('');
    }
  });
});

describe('owner', () => {
  it('is done when an owner is set', () => {
    expect(readItem('owner', {}).state).toBe('done');
  });

  it('needs action, opening Change Details, when empty', () => {
    const item = readItem('owner', { change: { changeNumber: 'CHG1', stateLabel: 'New', ownerName: ' ', configItemName: 'Recon' } });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'changeDetails' });
  });
});

describe('riskCheck', () => {
  it('needs action when no review was run', () => {
    const item = readItem('riskCheck', { riskReview: null });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'riskCheck' });
  });

  it('needs action when the review is not ready', () => {
    expect(readItem('riskCheck', { riskReview: { isReady: false } }).state).toBe('needsAction');
  });
});

describe('rcp', () => {
  it('is not applicable off Production', () => {
    expect(readItem('rcp', { isProduction: false }).state).toBe('notApplicable');
  });

  it('is not applicable when the rules are off or expired', () => {
    expect(readItem('rcp', { isRcpActive: false }).state).toBe('notApplicable');
  });

  it('needs action, opening the RCP checklist, when a rule fails', () => {
    const failingChecks: RcpCheckResult[] = [...PASSING_RCP_CHECKS, { ruleId: 'leadTime', title: 'Lead time', status: 'fail', detail: 'Too late.' }];
    const item = readItem('rcp', { rcpChecks: failingChecks });
    expect(item.state).toBe('needsAction');
    expect(item.reason).toContain('Lead time');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'rcpChecklist' });
  });

  it('could not check when a rule needs a person to confirm what was unreadable', () => {
    const unsureChecks: RcpCheckResult[] = [{ ruleId: 'approval', title: 'Director approval attached', status: 'check', detail: 'Attachments unreadable.' }];
    expect(readItem('rcp', { rcpChecks: unsureChecks }).state).toBe('couldNotCheck');
  });
});

describe('outage', () => {
  it('needs action with the create-outage fix when none is linked', () => {
    const item = readItem('outage', { outageCount: 0 });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'fixNow', fixId: 'createPlannedOutage' });
  });

  it('is not applicable off Production', () => {
    expect(readItem('outage', { isProduction: false, outageCount: 0 }).state).toBe('notApplicable');
  });
});

describe('ctaskCi', () => {
  it('is not applicable with no tasks', () => {
    expect(readItem('ctaskCi', { ctasks: [] }).state).toBe('notApplicable');
  });

  it('needs action with a fix that names how many tasks differ', () => {
    const item = readItem('ctaskCi', {
      ctasks: [
        { number: 'CTASK1', isImplementation: true, isConfigItemMatching: false, hasBackoutPlan: true, hasPlannedDates: true },
        { number: 'CTASK2', isImplementation: false, isConfigItemMatching: false, hasBackoutPlan: true, hasPlannedDates: true },
      ],
    });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'fixNow', fixId: 'setCtaskConfigItems', targetCount: 2 });
    expect(item.reason).toContain('CTASK1');
  });

  it('opens Change Details instead when the change itself has no configuration item', () => {
    const item = readItem('ctaskCi', {
      change: { changeNumber: 'CHG1', stateLabel: 'New', ownerName: 'Lee', configItemName: '' },
      ctasks: [{ number: 'CTASK1', isImplementation: true, isConfigItemMatching: false, hasBackoutPlan: true, hasPlannedDates: true }],
    });
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'changeDetails' });
  });
});

describe('ctaskBackout', () => {
  it('is not applicable with no implementation task', () => {
    const item = readItem('ctaskBackout', {
      ctasks: [{ number: 'CTASK2', isImplementation: false, isConfigItemMatching: true, hasBackoutPlan: false, hasPlannedDates: true }],
    });
    expect(item.state).toBe('notApplicable');
  });

  it('needs action, opening the risk check fix round, when an implementation task has no plan', () => {
    const item = readItem('ctaskBackout', {
      ctasks: [{ number: 'CTASK1', isImplementation: true, isConfigItemMatching: true, hasBackoutPlan: false, hasPlannedDates: true }],
    });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'riskCheckFixRound' });
  });
});

describe('ctaskDates', () => {
  it('is not applicable with no tasks', () => {
    expect(readItem('ctaskDates', { ctasks: [] }).state).toBe('notApplicable');
  });

  it('needs action, opening the CTASK timeline, when a task lacks dates', () => {
    const item = readItem('ctaskDates', {
      ctasks: [{ number: 'CTASK1', isImplementation: true, isConfigItemMatching: true, hasBackoutPlan: true, hasPlannedDates: false }],
    });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'ctaskTimeline' });
  });
});

describe('prbs', () => {
  it('is not applicable when no PRB is mentioned', () => {
    expect(readItem('prbs', { prbs: [] }).state).toBe('notApplicable');
  });

  it('needs action with the link fix when a PRB is unlinked', () => {
    const item = readItem('prbs', {
      prbs: [{ prbNumber: 'PRB0001', linkStatus: 'unlinked' }, { prbNumber: 'PRB0002', linkStatus: 'unlinked' }],
    });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'fixNow', fixId: 'linkProblems', targetCount: 2 });
  });

  it('opens the problems panel when the only unlinked PRBs cannot be linked from here', () => {
    const item = readItem('prbs', {
      prbs: [{ prbNumber: 'PRB0003', linkStatus: 'otherChange' }, { prbNumber: 'PRB0004', linkStatus: 'notInServiceNow' }],
    });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'problems' });
  });
});

describe('testEvidence', () => {
  it('needs action, opening Test evidence, with no attachment', () => {
    const item = readItem('testEvidence', { attachmentFileNames: [] });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'testEvidence' });
  });

  it('is not applicable off Production', () => {
    expect(readItem('testEvidence', { isProduction: false, attachmentFileNames: [] }).state).toBe('notApplicable');
  });

  it('judges the files against the issues when they are known: an issue with no file needs action', () => {
    const item = readItem('testEvidence', { testEvidenceCoverage: { issuesWithoutEvidence: ['ABC-2'], issuesMissingFromTestPlan: [] } });
    expect(item.state).toBe('needsAction');
    expect(item.reason).toContain('but ABC-2 has no test evidence file.');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'testEvidence' });
  });

  it('sends a test plan that never names an evidenced issue back to the writing', () => {
    const item = readItem('testEvidence', { testEvidenceCoverage: { issuesWithoutEvidence: [], issuesMissingFromTestPlan: ['ABC-1'] } });
    expect(item.reason).toBe('The test plan does not name ABC-1, whose test evidence is attached.');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'changeText', focusField: 'testPlan' });
  });

  it('is done when every issue has a file the test plan names', () => {
    const item = readItem('testEvidence', { testEvidenceCoverage: { issuesWithoutEvidence: [], issuesMissingFromTestPlan: [] } });
    expect(item.state).toBe('done');
    expect(item.reason).toContain('covering every issue');
  });
});

describe('ctaskDates — the timeline', () => {
  it('needs action when dated tasks still run past the window', () => {
    const item = readItem('ctaskDates', { ctaskTimelineProblems: ["On the PRD change the tasks run 15 minutes past the window's end."] });
    expect(item.state).toBe('needsAction');
    expect(item.reason).toContain('15 minutes past');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'ctaskTimeline' });
  });
});

describe('Formula Card sections', () => {
  const textItemCases: Array<[ReadinessItemId, ChgTextFieldKey]> = [
    ['formulaIdentity', 'description'],
    ['formulaBusinessNeed', 'justification'],
    ['formulaRisk', 'riskImpact'],
    ['formulaImplementation', 'implementationPlan'],
    ['formulaTesting', 'testPlan'],
    ['formulaBackout', 'backoutPlan'],
  ];

  it.each(textItemCases)('%s needs action, opening its text, when %s is empty', (itemId, fieldKey) => {
    const item = readItem(itemId, { textFields: { ...COMPLETE_TEXT_FIELDS, [fieldKey]: '   ' } });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'changeText', focusField: fieldKey });
  });

  it.each(textItemCases)('%s needs action when %s still holds a CONFIRM placeholder', (itemId, fieldKey) => {
    const item = readItem(itemId, { textFields: { ...COMPLETE_TEXT_FIELDS, [fieldKey]: 'Done by [CONFIRM: who?]' } });
    expect(item.state).toBe('needsAction');
    expect(item.reason).toMatch(/confirm/i);
  });

  it('identity needs action when the change has no configuration item', () => {
    const item = readItem('formulaIdentity', { change: { changeNumber: 'CHG1', stateLabel: 'New', ownerName: 'Lee', configItemName: '' } });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'changeDetails' });
  });

  it('schedule needs action when a planned date is missing', () => {
    const item = readItem('formulaSchedule', { plannedWindow: { plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: null } });
    expect(item.state).toBe('needsAction');
    expect(item.action).toMatchObject({ kind: 'openStep', stepId: 'schedule' });
  });

  it('schedule needs action when the window ends before it starts', () => {
    const item = readItem('formulaSchedule', { plannedWindow: { plannedStartUtc: '2026-10-10T08:00:00Z', plannedEndUtc: '2026-10-10T00:30:00Z' } });
    expect(item.state).toBe('needsAction');
  });

  it('labels each section from the Formula Card', () => {
    const items = buildChangeReadiness(buildReadyFacts());
    expect(findItem(items, 'formulaIdentity').label).toMatch(/Change Identity/);
    expect(findItem(items, 'formulaBackout').label).toMatch(/Backout/);
  });
});

describe('could not check', () => {
  it('turns every null fact into couldNotCheck, never done', () => {
    const items = buildChangeReadiness(buildReadyFacts({ ...ALL_NULL_FACTS, riskReview: { isReady: true } }));
    const checkedIds = items.filter((item) => item.state !== 'couldNotCheck').map((item) => item.id);
    // The risk review is session state, not a read; every other item depends on a fact that failed.
    expect(checkedIds).toEqual(['riskCheck']);
  });

  it('carries the read failure reason when one was recorded', () => {
    const item = readItem('outage', { outageCount: null, failureReasons: { outages: 'ServiceNow refused the outage read (403).' } });
    expect(item.state).toBe('couldNotCheck');
    expect(item.reason).toContain('403');
  });

  it('cannot check Production-only items while the environment is unknown', () => {
    expect(readItem('outage', { isProduction: null }).state).toBe('couldNotCheck');
    expect(readItem('rcp', { isProduction: null }).state).toBe('couldNotCheck');
    expect(readItem('testEvidence', { isProduction: null }).state).toBe('couldNotCheck');
  });

  it('is never ready while any item could not be checked', () => {
    const items = buildChangeReadiness(buildReadyFacts({ outageCount: null }));
    expect(isReady(items)).toBe(false);
  });
});

describe('isReady', () => {
  it('is false while any item needs action', () => {
    expect(isReady(buildChangeReadiness(buildReadyFacts({ riskReview: null })))).toBe(false);
  });

  it('is true when the only non-done items are not applicable', () => {
    expect(isReady(buildChangeReadiness(buildReadyFacts({ isProduction: false, prbs: [], ctasks: [] })))).toBe(true);
  });
});

describe('actions', () => {
  const variedFacts: ChangeReadinessFacts[] = [
    buildReadyFacts(),
    buildReadyFacts({ ...ALL_NULL_FACTS }),
    buildReadyFacts({ riskReview: null, outageCount: 0, attachmentFileNames: [], prbs: [{ prbNumber: 'PRB1', linkStatus: 'unlinked' }] }),
    buildReadyFacts({ isProduction: false, textFields: { ...COMPLETE_TEXT_FIELDS, testPlan: '' } }),
  ];

  it('carry an action exactly when the item needs action, on an editable change', () => {
    for (const facts of variedFacts) {
      for (const item of buildChangeReadiness(facts)) {
        expect(item.action !== null).toBe(item.state === 'needsAction');
      }
    }
  });

  it('are data, never functions', () => {
    const items = buildChangeReadiness(variedFacts[2]);
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
  });

  it('never show an internal field name in a label, reason or action label', () => {
    for (const facts of variedFacts) {
      for (const item of buildChangeReadiness(facts)) {
        expect(`${item.label} ${item.reason} ${item.action?.label ?? ''}`).not.toMatch(INTERNAL_FIELD_NAME_PATTERN);
      }
    }
  });
});

describe('a change whose state forbids edits', () => {
  const closedFacts = buildReadyFacts({
    change: { changeNumber: 'CHG1', stateLabel: 'Closed Complete', ownerName: '', configItemName: 'Recon' },
    riskReview: null,
    outageCount: 0,
  });

  it('offers no action on any item and names the state in the reason', () => {
    const items = buildChangeReadiness(closedFacts);
    const failingItems = items.filter((item) => item.state === 'needsAction');
    expect(failingItems.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.action).toBeNull();
    }
    for (const item of failingItems) {
      expect(item.reason).toContain('Closed Complete');
    }
  });

  it.each(['Closed Complete', 'Cancelled', 'Implement'])('treats %s as not editable', (stateLabel) => {
    expect(isChangeEditable(stateLabel)).toBe(false);
  });

  it.each(['New', 'Assess', 'Scheduled', ''])('treats %s as editable', (stateLabel) => {
    expect(isChangeEditable(stateLabel)).toBe(true);
  });
});
