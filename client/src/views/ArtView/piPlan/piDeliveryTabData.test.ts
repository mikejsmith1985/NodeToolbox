// piDeliveryTabData.test.ts — Pure adapters: Jira Feature issues + roster → fact-sheet inputs (spec 032, US1).

import { describe, expect, it } from 'vitest';

import { toFactSheetFeatureInputs, toFactSheetPersonInputs, rosterRolesFor, deriveSprints } from './piDeliveryTabData.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';

const SIZE_FIELD = 'customfield_10002';

function issue(key: string, fields: Record<string, unknown>): JiraIssue {
  return { key, fields: fields as JiraIssue['fields'] } as JiraIssue;
}

describe('toFactSheetFeatureInputs', () => {
  it('maps key, summary, size, components, priority, fixVersion and dependencies', () => {
    const issues = [issue('DENP-100', {
      summary: 'Enrollment', [SIZE_FIELD]: 8, components: [{ id: 'c1', name: 'api' }, { id: 'c2', name: 'Enrollment' }],
      priority: { name: 'High' }, fixVersions: [{ name: '2026.08' }],
      issuelinks: [{ outwardIssue: { key: 'DENP-99' } }],
    })];
    const [feature] = toFactSheetFeatureInputs(issues, SIZE_FIELD);
    expect(feature.key).toBe('DENP-100');
    expect(feature.sizePoints).toBe(8);
    expect(feature.componentNames).toEqual(['api', 'Enrollment']);
    expect(feature.priorityName).toBe('High');
    expect(feature.targetFixVersion).toBe('2026.08');
    expect(feature.dependencyKeys).toEqual(['DENP-99']);
  });

  it('reads a numeric string size and yields null for a missing size', () => {
    const [withString] = toFactSheetFeatureInputs([issue('A-1', { summary: 'x', [SIZE_FIELD]: '13' })], SIZE_FIELD);
    expect(withString.sizePoints).toBe(13);
    const [missing] = toFactSheetFeatureInputs([issue('A-2', { summary: 'y' })], SIZE_FIELD);
    expect(missing.sizePoints).toBeNull();
  });
});

describe('rosterRolesFor / toFactSheetPersonInputs', () => {
  function member(displayName: string, caps: Record<string, boolean>): StandupRosterMember {
    return { displayName, roleCapabilities: caps } as unknown as StandupRosterMember;
  }

  it('maps capability flags to delivery roles', () => {
    expect(rosterRolesFor(member('X', { canDevelop: true, canInternalTest: true }))).toEqual(['dev', 'internalTest']);
    expect(rosterRolesFor(member('Y', {}))).toEqual([]);
  });

  it('keeps only members with a delivery role and defaults velocity', () => {
    const people = toFactSheetPersonInputs([
      member('Dev', { canDevelop: true }),
      member('Nobody', {}),
      member('SL', { canInternalTest: true }),
    ], { Dev: 12 });
    expect(people.map((p) => p.displayName)).toEqual(['Dev', 'SL']);
    expect(people.find((p) => p.displayName === 'Dev')?.velocity).toBe(12);
    expect(people.find((p) => p.displayName === 'SL')?.velocity).toBe(8); // default
  });
});

describe('deriveSprints', () => {
  it('derives N evenly-spaced, named sprint windows across the PI', () => {
    const sprints = deriveSprints('2026-07-30', '2026-10-07', 5, '26.4');
    expect(sprints).toHaveLength(5);
    expect(sprints[0].name).toBe('26.4.1');
    expect(sprints[0].startIso).toBe('2026-07-30');
    expect(sprints[4].name).toBe('26.4.5');
    // each sprint starts on/after the previous
    for (let index = 1; index < sprints.length; index += 1) {
      expect(sprints[index].startIso >= sprints[index - 1].startIso).toBe(true);
    }
  });
});

describe('versionsToReleaseSchedule', () => {
  it('keeps dated non-archived versions, sorted by date, ignoring archived/undated', () => {
    const { versionsToReleaseSchedule } = require('./piDeliveryTabData.ts');
    const schedule = versionsToReleaseSchedule([
      { name: 'Sept', releaseDate: '2026-09-30' },
      { name: 'Archived', releaseDate: '2026-08-01', archived: true },
      { name: 'No date' },
      { name: 'Aug', releaseDate: '2026-08-31' },
    ]);
    expect(schedule.entries.map((e: { name: string }) => e.name)).toEqual(['Aug', 'Sept']);
    expect(schedule.entries[0].releaseDateIso).toBe('2026-08-31');
    expect(schedule.entries[0].isSuggested).toBe(false);
  });
});
