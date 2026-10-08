// teamStandardsStore.test.ts — The team's standing answers, kept on this machine and editable in Admin Hub.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TEAM_STANDARDS,
  readTeamStandards,
  resetTeamStandards,
  TEAM_STANDARDS_STORAGE_KEY,
  writeTeamStandards,
} from './teamStandardsStore.ts';

describe('teamStandardsStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts from the team\'s current standing answers', () => {
    expect(readTeamStandards()).toEqual(DEFAULT_TEAM_STANDARDS);
    expect(DEFAULT_TEAM_STANDARDS.map((standard) => standard.fieldName))
      .toEqual(['Bridge or Command Center', 'Test Results', 'Escalation Path']);
  });

  it('keeps edited answers, dropping blank rows', () => {
    writeTeamStandards([
      { fieldName: 'Escalation Path', answer: 'Start with the on-call lead.' },
      { fieldName: 'Test Results', answer: '   ' },
    ]);

    expect(readTeamStandards()).toEqual([{ fieldName: 'Escalation Path', answer: 'Start with the on-call lead.' }]);
  });

  it('keeps an empty list when every standard is removed on purpose', () => {
    writeTeamStandards([]);

    expect(readTeamStandards()).toEqual([]);
  });

  it('falls back to the defaults when what is stored cannot be read', () => {
    window.localStorage.setItem(TEAM_STANDARDS_STORAGE_KEY, '{not json');

    expect(readTeamStandards()).toEqual(DEFAULT_TEAM_STANDARDS);
  });

  it('goes back to the defaults on reset', () => {
    writeTeamStandards([]);
    resetTeamStandards();

    expect(readTeamStandards()).toEqual(DEFAULT_TEAM_STANDARDS);
  });

  it('is stored under a tbx key, so Settings Backup carries it', () => {
    expect(TEAM_STANDARDS_STORAGE_KEY.startsWith('tbx')).toBe(true);
  });
});
