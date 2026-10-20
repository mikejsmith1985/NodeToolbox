// implementationBackout.test.ts — Proves Implementation tasks take the change's backout plan, and keep their own.

import { describe, expect, it } from 'vitest';

import { readBackoutSectionFromDescription, upsertBackoutSection } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';
import { isImplementationTask, listImplementationBackoutUpdates } from './implementationBackout.ts';

const IMPLEMENTATION = { id: 'impl', changeTaskType: 'Implementation', description: 'Deploy the portal.' };
const CHECKOUT = { id: 'check', changeTaskType: 'Business Checkout', description: 'Log in.' };

describe('listImplementationBackoutUpdates', () => {
  it('gives an Implementation task without a backout plan the change\'s plan, and leaves other tasks alone', () => {
    const updates = listImplementationBackoutUpdates([IMPLEMENTATION, CHECKOUT], '1. Redeploy v1', '');
    expect(updates).toHaveLength(1);
    expect(updates[0].taskId).toBe('impl');
    expect(readBackoutSectionFromDescription(updates[0].description)).toBe('1. Redeploy v1');
    expect(updates[0].description).toContain('Deploy the portal.');
  });

  it('keeps a task\'s own, different backout plan', () => {
    const ownPlanTask = { ...IMPLEMENTATION, description: upsertBackoutSection('Deploy.', 'Restore the snapshot') };
    expect(listImplementationBackoutUpdates([ownPlanTask], '1. Redeploy v1', '')).toEqual([]);
  });

  it('follows the change\'s plan when it is rewritten, for a task still holding the earlier copy', () => {
    const copiedTask = { ...IMPLEMENTATION, description: upsertBackoutSection('Deploy.', '1. Old plan') };
    const updates = listImplementationBackoutUpdates([copiedTask], '1. New plan', '1. Old plan');
    expect(readBackoutSectionFromDescription(updates[0].description)).toBe('1. New plan');
  });

  it('does nothing while the change has no backout plan', () => {
    expect(listImplementationBackoutUpdates([IMPLEMENTATION], '  ', '')).toEqual([]);
  });

  it('recognises the Implementation type whatever its case', () => {
    expect(isImplementationTask({ changeTaskType: ' implementation ' })).toBe(true);
    expect(isImplementationTask({ changeTaskType: 'Technical Checkout' })).toBe(false);
  });
});
