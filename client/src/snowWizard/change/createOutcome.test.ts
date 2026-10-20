// createOutcome.test.ts — Proves the create result line is read into per-environment changes, notes and what is missing.

import { describe, expect, it } from 'vitest';

import { buildChangeLink, mergeCreatedChanges, readCreateOutcome } from './createOutcome.ts';

describe('readCreateOutcome', () => {
  it('reads every environment\'s change from a full success, with the notes after it', () => {
    const outcome = readCreateOutcome(
      '2 CHGs created with 1 CTASK each: REL CHG0001, PRD CHG0002 (outage OUT9); PRB1 linked to CHG0002',
      ['REL', 'PRD'],
    );
    expect(outcome.createdChanges).toEqual([
      { environmentLabel: 'REL', changeNumber: 'CHG0001' },
      { environmentLabel: 'PRD', changeNumber: 'CHG0002' },
    ]);
    expect(outcome.notes).toEqual(['PRB1 linked to CHG0002']);
    expect(outcome.failureText).toBeNull();
    expect(outcome.missingEnvironments).toEqual([]);
    expect(outcome.isComplete).toBe(true);
  });

  it('gives a single change the one environment that was asked for', () => {
    const outcome = readCreateOutcome('CHG0003 created with 2 CTASKs and outage OUT1', ['PRD']);
    expect(outcome.createdChanges).toEqual([{ environmentLabel: 'PRD', changeNumber: 'CHG0003' }]);
    expect(outcome.isComplete).toBe(true);
  });

  it('reads a partial create: what exists, what failed, and which environments are still missing', () => {
    const outcome = readCreateOutcome('CHG0004 created; then a later submission failed: ServiceNow said no', ['REL', 'PRD', 'PFIX']);
    expect(outcome.createdChanges).toEqual([{ environmentLabel: 'REL', changeNumber: 'CHG0004' }]);
    expect(outcome.failureText).toBe('ServiceNow said no');
    expect(outcome.missingEnvironments).toEqual(['PRD', 'PFIX']);
    expect(outcome.isComplete).toBe(false);
  });

  it('reads a change that was made but whose tasks were not', () => {
    const outcome = readCreateOutcome('CHG0005 created, but 1 CTASK did not fully complete. Check ServiceNow before retrying: 403', ['REL']);
    expect(outcome.createdChanges).toEqual([{ environmentLabel: 'REL', changeNumber: 'CHG0005' }]);
    expect(outcome.failureText).toBe('1 CTASK did not fully complete. Check ServiceNow before retrying: 403');
    expect(outcome.missingEnvironments).toEqual([]);
  });

  it('reads an outright failure, nothing created', () => {
    const outcome = readCreateOutcome('Error: HTTP 403', ['REL', 'PRD']);
    expect(outcome.createdChanges).toEqual([]);
    expect(outcome.failureText).toBe('HTTP 403');
    expect(outcome.missingEnvironments).toEqual(['REL', 'PRD']);
  });

  it('treats a refusal before anything was sent as a failure', () => {
    expect(readCreateOutcome('Choose at least one environment before creating.', ['REL']).failureText)
      .toBe('Choose at least one environment before creating.');
  });
});

describe('mergeCreatedChanges', () => {
  it('adds a retry\'s changes to the earlier ones without repeating an environment', () => {
    expect(mergeCreatedChanges(
      [{ environmentLabel: 'REL', changeNumber: 'CHG1' }],
      [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
    )).toEqual([{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }]);
  });
});

describe('buildChangeLink', () => {
  it('opens the change by number on the ServiceNow site the Wizard runs in', () => {
    expect(buildChangeLink('https://example.service-now.com', 'CHG0001'))
      .toBe('https://example.service-now.com/change_request.do?sysparm_query=number%3DCHG0001');
  });
});
