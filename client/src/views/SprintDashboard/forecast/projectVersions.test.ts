// projectVersions.test.ts — Whether a version's real metadata reaches the forecast.
//
// The board and the Today dashboard read fix versions off the ISSUES, which carry only a name. That
// leaves the engine unable to tell a live release from one that shipped last year, and a carryover
// issue still tagged with a shipped version then reads as catastrophically late against a date
// nobody is working to any more.

import { describe, expect, it } from 'vitest';

import { mergeProjectVersionMetadata } from './projectVersions.ts';

const PROJECT_VERSIONS = [
  { name: 'Release 10/02/2026', releaseDate: '2026-10-02', released: false, archived: false },
  { name: 'Release 07/24/2025', releaseDate: '2025-07-24', released: true, archived: false },
  { name: 'Sprint 24.2.1', released: false, archived: true },
];

describe('mergeProjectVersionMetadata', () => {
  it('marks a referenced version that has already shipped as released', () => {
    const merged = mergeProjectVersionMetadata(['Release 07/24/2025'], PROJECT_VERSIONS);
    expect(merged).toEqual([{ name: 'Release 07/24/2025', releaseDate: '2025-07-24', released: true }]);
  });

  it('carries the release-date FIELD through, so it can win over the name', () => {
    const merged = mergeProjectVersionMetadata(['Release 10/02/2026'], PROJECT_VERSIONS);
    expect(merged[0].releaseDate).toBe('2026-10-02');
    expect(merged[0].released).toBe(false);
  });

  it('keeps a referenced version the project list does not explain, rather than dropping it', () => {
    // Dropping it would remove the work's only deadline and quietly reclassify it as having none.
    // The name still carries a date by convention, which is what releaseDateResolve is for.
    const merged = mergeProjectVersionMetadata(['Release 12/25/2026'], PROJECT_VERSIONS);
    expect(merged).toEqual([{ name: 'Release 12/25/2026', releaseDate: null, released: false }]);
  });

  it('preserves the order the work referenced them in', () => {
    const merged = mergeProjectVersionMetadata(['Release 07/24/2025', 'Release 10/02/2026'], PROJECT_VERSIONS);
    expect(merged.map((version) => version.name)).toEqual(['Release 07/24/2025', 'Release 10/02/2026']);
  });

  it('works with no project list at all, which is what a failed fetch leaves behind', () => {
    const merged = mergeProjectVersionMetadata(['Release 10/02/2026'], []);
    expect(merged).toEqual([{ name: 'Release 10/02/2026', releaseDate: null, released: false }]);
  });

  it('matches names ignoring surrounding whitespace, which Jira permits and people type', () => {
    const merged = mergeProjectVersionMetadata(['  Release 10/02/2026 '], PROJECT_VERSIONS);
    expect(merged[0].released).toBe(false);
    expect(merged[0].releaseDate).toBe('2026-10-02');
  });
});
