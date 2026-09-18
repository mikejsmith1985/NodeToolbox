// startIntake.test.ts — Starting an intake from GH #387 applies every rule before anyone is asked (spec 037, US1/US2).

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../sources/sourceModel.ts';
import { readItemDisplayTitle } from './epicIntakeModel.ts';
import { GH387_NOTES_TEXT } from './gh387Notes.fixture.ts';
import { proveLineCoverage } from './notesOutline.ts';
import { startEpicIntake } from './startIntake.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

const GH387_SOURCE: ReferencedSource = { kind: 'paste', id: 'paste-1', label: 'Monday Product Call notes', text: GH387_NOTES_TEXT };

function startGh387() {
  return startEpicIntake({ teamProfileId: 'team-a', sources: [GH387_SOURCE], nowIso: NOW_ISO, mintId: () => 'intake-1' });
}

function findItem(titlePrefix: string) {
  const item = startGh387().items.find((candidate) => readItemDisplayTitle(candidate).startsWith(titlePrefix));
  if (item === undefined) throw new Error(`No item starting "${titlePrefix}"`);
  return item;
}

describe('startEpicIntake on GH #387', () => {
  it('builds a named, resumable intake targeting DENP with every line accounted for', () => {
    const intake = startGh387();
    expect(intake).toMatchObject({ id: 'intake-1', teamProfileId: 'team-a', targetProjectKey: 'DENP', name: 'Monday Product Call notes — 2026-09-18' });
    expect(proveLineCoverage(intake).isComplete).toBe(true);
  });

  it('sets the source title aside rather than making it an item', () => {
    const intake = startGh387();
    expect(intake.lines[0]).toMatchObject({ text: 'Monday Product Call notes', outlineLevel: 0 });
    expect(intake.setAsideLines.map((setAside) => setAside.lineNumber)).toContain(1);
  });

  it('decides Core Integration is Enrollment by the stated sizes, with its named key', () => {
    const coreIntegration = findItem('Core Integration');
    expect(coreIntegration.decisions.owner).toMatchObject({ state: 'settled', value: 'enrollment', settledBy: 'rule', reason: 'Stated sizes: Enrollment XL vs Fulfillment M' });
    expect(coreIntegration.namedKeys.map((namedKey) => namedKey.key)).toEqual(['DENP-632']);
  });

  it('decides Invoice overhaul is Fulfillment by the stated sizes', () => {
    expect(findItem('Invoice overhaul').decisions.owner).toMatchObject({ state: 'settled', value: 'fulfillment', settledBy: 'rule' });
  });

  it('leaves DSNP Module Activation for an estimate — no Enrollment or Fulfillment size is stated', () => {
    expect(findItem('DSNP Module Activation').decisions.owner).toMatchObject({ state: 'open', isAwaitingPo: false });
  });

  it('marks a rejected idea card as deferred by rule, with the phrase as the reason, for the PO to flip', () => {
    expect(findItem('ID Card Vendor Change').decisions.kind).toMatchObject({ state: 'settled', value: 'deferred', settledBy: 'rule' });
  });

  it('marks the future conversation as deferred', () => {
    expect(findItem('Mass ID Card Reissue').decisions.kind).toMatchObject({ state: 'settled', value: 'deferred', settledBy: 'rule' });
  });

  it('treats a plain list beside bulleted notes as one item per line', () => {
    const plainList: ReferencedSource = { kind: 'paste', id: 'paste-2', label: 'Backlog', text: 'Paperless Options\nTech Debt' };
    const intake = startEpicIntake({ teamProfileId: 't', sources: [GH387_SOURCE, plainList], nowIso: NOW_ISO, mintId: () => 'x' });
    const titles = intake.items.map((item) => item.title);
    expect(titles.slice(-2)).toEqual(['Paperless Options', 'Tech Debt']);
    expect(titles).not.toContain('Backlog');
  });
});
