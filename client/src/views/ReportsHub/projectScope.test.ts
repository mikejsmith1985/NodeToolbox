// projectScope.test.ts — Tests for narrowing a person-scoped flow report to one Jira project.
//
// The reason this exists: the flow reports query by roster member across every project those people
// touch, so a report meant to describe the ENCUC project arrives full of ENFCT and INTTEST issues.
// These pin that the dropdown offers only projects the roster actually worked in, and that filtering
// to one is exact.

import { describe, expect, it } from 'vitest';

import { ALL_PROJECTS, collectProjectKeys, extractProjectKey, filterByProject } from './projectScope.ts';

describe('extractProjectKey', () => {
  it('reads the project key from an issue key', () => {
    expect(extractProjectKey('ENCUC-2019')).toBe('ENCUC');
    expect(extractProjectKey('INTTEST-4006')).toBe('INTTEST');
  });

  it('takes the text before the FINAL dash, tolerating a dash elsewhere', () => {
    // Defensive: standard keys have no dash in the project, but a malformed key must not silently
    // become a project that does not exist.
    expect(extractProjectKey('ENCUC-2019-b')).toBe('ENCUC-2019');
  });

  it('returns a dashless key unchanged rather than inventing a project', () => {
    expect(extractProjectKey('LOOSE')).toBe('LOOSE');
  });
});

describe('collectProjectKeys', () => {
  it('lists each distinct project once, alphabetically', () => {
    expect(collectProjectKeys(['ENCUC-1', 'INTTEST-2', 'ENCUC-3', 'ENFCT-4'])).toEqual([
      'ENCUC', 'ENFCT', 'INTTEST',
    ]);
  });

  it('returns nothing for an empty set', () => {
    expect(collectProjectKeys([])).toEqual([]);
  });
});

describe('filterByProject', () => {
  const items = [
    { issueKey: 'ENCUC-1', value: 'a' },
    { issueKey: 'INTTEST-2', value: 'b' },
    { issueKey: 'ENCUC-3', value: 'c' },
  ];

  it('keeps only the chosen project', () => {
    expect(filterByProject(items, 'ENCUC').map((item) => item.issueKey)).toEqual(['ENCUC-1', 'ENCUC-3']);
  });

  it('returns everything, as a copy, for ALL_PROJECTS', () => {
    const result = filterByProject(items, ALL_PROJECTS);

    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it('returns nothing when the project is absent', () => {
    expect(filterByProject(items, 'NOPE')).toEqual([]);
  });
});
