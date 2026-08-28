// teamContextStore.test.ts — Remembering what somebody told the assistant about their team.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TEAM_CONTEXT_CHARS, readTeamContext, writeTeamContext } from './teamContextStore.ts';

describe('teamContextStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('remembers what was typed, so it survives AI Assist being toggled off', () => {
    // Held only in component state it vanished with the panel, and retyping three sentences on every
    // run is the kind of friction that stops a feature being used at all.
    writeTeamContext('Nine developers, one shift-left tester.');

    expect(readTeamContext()).toBe('Nine developers, one shift-left tester.');
  });

  it('reads empty before anything has been saved', () => {
    expect(readTeamContext()).toBe('');
  });

  it('replaces the previous note rather than appending to it', () => {
    writeTeamContext('First.');
    writeTeamContext('Second.');

    expect(readTeamContext()).toBe('Second.');
  });

  it('caps what it keeps, so context cannot crowd the report out of its own prompt', () => {
    writeTeamContext('x'.repeat(MAX_TEAM_CONTEXT_CHARS + 500));

    expect(readTeamContext()).toHaveLength(MAX_TEAM_CONTEXT_CHARS);
  });

  it('reads empty rather than throwing when storage cannot be read', () => {
    // A locked-down browser or a private window. A report that refused to render because it could not
    // read a note about the team would be a poor trade for a convenience.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is unavailable');
    });

    expect(readTeamContext()).toBe('');
  });

  it('stays silent rather than throwing when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is full');
    });

    expect(() => writeTeamContext('Anything.')).not.toThrow();
  });
});
