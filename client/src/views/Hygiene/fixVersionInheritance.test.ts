// fixVersionInheritance.test.ts — Copying the release from the Feature, and refusing when it cannot.

import { describe, expect, it } from 'vitest';

import { chooseInheritedFixVersion } from './fixVersionInheritance.ts';

describe('chooseInheritedFixVersion', () => {
  it('takes the Feature-s driving release and names where it came from', () => {
    const choice = chooseInheritedFixVersion('ENCUC-100', [{ name: '2026.09', releaseDate: '2026-09-30' }]);

    expect(choice.fixVersionName).toBe('2026.09');
    expect(choice.sourceIssueKey).toBe('ENCUC-100');
    expect(choice.declinedReason).toBeNull();
  });

  it('inherits the EARLIEST unreleased release, matching what the date policy would use', () => {
    // A child that inherits a different version from the one its dates get derived from produces a
    // date nobody can explain, weeks later.
    const choice = chooseInheritedFixVersion('ENCUC-100', [
      { name: '2026.12', releaseDate: '2026-12-31' },
      { name: '2026.09', releaseDate: '2026-09-30' },
    ]);

    expect(choice.fixVersionName).toBe('2026.09');
  });

  it('refuses when there is no Feature to copy from', () => {
    const choice = chooseInheritedFixVersion(null, []);

    expect(choice.fixVersionName).toBeNull();
    expect(choice.declinedReason).toBe('the issue has no Feature link to copy a release from');
  });

  it('explains a Feature that cannot date its own work in the same words the date policy uses', () => {
    const choice = chooseInheritedFixVersion('ENCUC-100', [{ name: '2026.09' }]);

    expect(choice.fixVersionName).toBeNull();
    expect(choice.declinedReason).toBe(
      'ENCUC-100 cannot supply one: fix version has no release date in Jira (2026.09)',
    );
  });

  it('refuses a released-only Feature rather than back-dating the child', () => {
    const choice = chooseInheritedFixVersion('ENCUC-100', [
      { name: '2026.06', releaseDate: '2026-06-30', released: true },
    ]);

    expect(choice.declinedReason).toContain('already released');
  });

  it('refuses a nameless version — the write is by name, so an empty one would clear the field', () => {
    const choice = chooseInheritedFixVersion('ENCUC-100', [{ releaseDate: '2026-09-30' }]);

    expect(choice.fixVersionName).toBeNull();
    expect(choice.declinedReason).toBe("ENCUC-100's fix version has no name to copy");
  });
});
