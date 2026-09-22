// intakeFacts.test.ts — Item facts come from the item's own lines, and rules settle what they can without asking.

import { describe, expect, it } from 'vitest';

import { createIntakeItem, type Decision, type SourceLine } from './epicIntakeModel.ts';
import { deriveItemFacts } from './intakeFacts.ts';
import { buildOutlineBaseline, numberSourceLines } from './notesOutline.ts';

function findItemByTitle(titlePrefix: string, notes: string) {
  const lines = numberSourceLines(notes);
  const { items } = buildOutlineBaseline(lines);
  const item = items.find((candidate) => candidate.title.startsWith(titlePrefix));
  if (item === undefined) throw new Error(`no item ${titlePrefix}`);
  return { item: deriveItemFacts(item, lines), lines };
}

describe('deriveItemFacts', () => {
  it('settles Enrollment by stated sizes and records the named key', () => {
    const { item } = findItemByTitle('Core', '•\tCore Integration (denp-632)\no\t(1.2M) XL Enrollment\no\tFulfillment M\no\tInfra XL\no\tFacets M');
    expect(item.decisions.owner).toMatchObject({ state: 'settled', value: 'enrollment', settledBy: 'rule' });
    expect(item.namedKeys.map((namedKey) => namedKey.key)).toEqual(['DENP-632']);
    expect(item.areaSizes.map((areaSize) => `${areaSize.area} ${areaSize.size}`)).toEqual(
      expect.arrayContaining(['Infra XL', 'Facets M']),
    );
  });

  it('settles Fulfillment for the Fulfilment spelling', () => {
    const { item } = findItemByTitle('Invoice', '•\tInvoice overhaul\no\tAnalysis\no\tFulfilment dev M\no\tBilling dev M\no\tTesting');
    expect(item.decisions.owner).toMatchObject({ state: 'settled', value: 'fulfillment', settledBy: 'rule' });
  });

  it('hands equal sizes to the PO', () => {
    const { item } = findItemByTitle('Tie', '•\tTie\no\tEnrollment M\no\tFulfillment M');
    expect(item.decisions.owner).toMatchObject({ state: 'open', isAwaitingPo: true, aiProposal: 'shared' });
  });

  it('leaves the owner open when no owning area size is stated', () => {
    const { item } = findItemByTitle('ID Card', '•\tID Card Vendor Change\no\tVendor size L\no\tDev size L');
    expect(item.decisions.owner).toMatchObject({ state: 'open', isAwaitingPo: false });
  });

  it('settles a deferred kind from the title line and closes the downstream slots', () => {
    const { item } = findItemByTitle('Mass', '•\tMass ID Card Reissue - future conversation');
    expect(item.decisions.kind).toMatchObject({ state: 'settled', value: 'deferred', settledBy: 'rule' });
    expect(item.decisions.owner.state).toBe('notApplicable');
  });

  it('never overrides an owner the PO chose', () => {
    const lines: SourceLine[] = numberSourceLines('•\tCore\no\tXL Enrollment\no\tFulfillment M');
    const poOwner: Decision<'enrollment' | 'fulfillment' | 'notActionable'> = { state: 'settled', value: 'fulfillment', settledBy: 'po', reason: 'PO', aiAttempts: 0 };
    const item = { ...createIntakeItem(1, 'Core', [1, 2, 3]), decisions: { ...createIntakeItem(1, 'Core', [1]).decisions, owner: poOwner } };
    expect(deriveItemFacts(item, lines).decisions.owner).toBe(poOwner);
  });

  it('keeps a key lookup already made when the item is regrouped', () => {
    const lines = numberSourceLines('•\tCore (denp-632)\no\tmore');
    const item = createIntakeItem(1, 'Core (denp-632)', [1]);
    item.namedKeys = [{ key: 'DENP-632', projectKey: 'DENP', lineNumber: 1, lookup: { status: 'openEpicInTarget', summary: 'Core' } }];
    const regrouped = deriveItemFacts({ ...item, lineNumbers: [1, 2] }, lines);
    expect(regrouped.namedKeys[0].lookup).toEqual({ status: 'openEpicInTarget', summary: 'Core' });
  });
});
