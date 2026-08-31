// ctaskDuplicates.test.ts — Proves a staged CTASK is not created a second time under a new name.

import { describe, expect, it } from 'vitest';

import { listStagedCtasksToCreate } from './ctaskDuplicates.ts';

/** A staged CTASK carrying only the fields the duplicate rule reads. */
function stagedCtask(shortDescription: string, name = ''): { shortDescription: string; name: string } {
  return { shortDescription, name };
}

describe('listStagedCtasksToCreate — the PFIX that arrived with four CTASKs', () => {
  it('drops a staged implementation whose environment has gone stale', () => {
    // The reported defect (GH #376). ServiceNow auto-spawns an Implementation and a Technical
    // Checkout; the wizard renames both to this change's environment AND then created every staged
    // template as new — so one PFIX change came back with two Implementations (one still saying
    // PRD, from a template saved during an earlier release) and two Technical Checkouts.
    const staged = [
      stagedCtask('Enrollment - AWS - PRD'),
      stagedCtask('Technical Checkout'),
    ];

    const toCreate = listStagedCtasksToCreate(staged, ['implementation', 'technicalCheckout'], 'Enrollment - AWS');

    expect(toCreate).toEqual([]);
  });

  it('keeps a staged task that is not one of the auto-created two', () => {
    const staged = [
      stagedCtask('Enrollment - AWS - PFIX'),
      stagedCtask('Smoke test the enrolment journey'),
    ];

    const toCreate = listStagedCtasksToCreate(staged, ['implementation', 'technicalCheckout'], 'Enrollment - AWS');

    expect(toCreate.map((task) => task.shortDescription)).toEqual(['Smoke test the enrolment journey']);
  });

  it('still creates the Technical Checkout when ServiceNow only auto-created one task', () => {
    // Only the roles actually adopted are skipped. A checkout nobody else made must still be made.
    const staged = [
      stagedCtask('Enrollment - AWS - PFIX'),
      stagedCtask('Technical Checkout'),
    ];

    const toCreate = listStagedCtasksToCreate(staged, ['implementation'], 'Enrollment - AWS');

    expect(toCreate.map((task) => task.shortDescription)).toEqual(['Technical Checkout']);
  });

  it('creates everything when ServiceNow auto-created nothing', () => {
    const staged = [stagedCtask('Enrollment - AWS - PFIX'), stagedCtask('Technical Checkout')];

    expect(listStagedCtasksToCreate(staged, [], 'Enrollment - AWS')).toHaveLength(2);
  });

  it('matches regardless of case and surrounding space', () => {
    const staged = [stagedCtask('  enrollment - aws - prd  '), stagedCtask('  TECHNICAL CHECKOUT ')];

    expect(listStagedCtasksToCreate(staged, ['implementation', 'technicalCheckout'], 'Enrollment - AWS'))
      .toEqual([]);
  });

  it('falls back to the template name when it carries no short description', () => {
    const staged = [stagedCtask('', 'Technical Checkout')];

    expect(listStagedCtasksToCreate(staged, ['technicalCheckout'], 'Enrollment - AWS')).toEqual([]);
  });

  it('never drops a staged task on an empty implementation prefix', () => {
    // Every short description starts with an empty string. Dropping on that would silently discard
    // the whole staged list.
    const staged = [stagedCtask('Anything at all')];

    expect(listStagedCtasksToCreate(staged, ['implementation'], '')).toHaveLength(1);
  });
});
