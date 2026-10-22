// projectSearch.test.ts — Proves projects are found by key first (exact, then starts-with), then by name, and listed by key.

import { describe, expect, it } from 'vitest';

import { findExactProjectKey, findProjects, labelProject } from './projectSearch.ts';

const PROJECTS = [
  { key: 'ENFCT', name: 'Fulfillment Core Team' },
  { key: 'DENP', name: 'Digital Enrollment Portfolio' },
  { key: 'ENCUC', name: 'Enrollment Customer Care' },
  { key: 'ENC', name: 'Encounters' },
];

describe('findProjects', () => {
  it('lists every project by key when nothing is typed', () => {
    expect(findProjects(PROJECTS, '').map((project) => project.key)).toEqual(['DENP', 'ENC', 'ENCUC', 'ENFCT']);
  });

  it('puts the exact key first, then keys starting with the text, then names containing it', () => {
    expect(findProjects(PROJECTS, 'enc').map((project) => project.key)).toEqual(['ENC', 'ENCUC']);
    expect(findProjects(PROJECTS, 'enrollment').map((project) => project.key)).toEqual(['DENP', 'ENCUC']);
  });

  it('ignores case and stray spaces', () => {
    expect(findProjects(PROJECTS, '  denp ').map((project) => project.key)).toEqual(['DENP']);
  });
});

describe('findExactProjectKey', () => {
  it('names the project whose key was typed in full, and nothing otherwise', () => {
    expect(findExactProjectKey(PROJECTS, 'encuc')).toBe('ENCUC');
    expect(findExactProjectKey(PROJECTS, 'ENCU')).toBe('');
  });
});

describe('labelProject', () => {
  it('leads with the key, which is how people know a project', () => {
    expect(labelProject(PROJECTS[1])).toBe('DENP — Digital Enrollment Portfolio');
  });
});
