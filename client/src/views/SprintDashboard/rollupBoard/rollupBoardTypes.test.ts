// rollupBoardTypes.test.ts — Pins the constants other modules and stored data depend on.
//
// These values are not arbitrary. Two of them end up inside issues' persisted grouping and inside
// Jira request URLs, so changing one silently would either strand stored preferences or change how
// hard the board leans on Jira. Naming them in a test makes any such change deliberate.

import { describe, expect, it } from 'vitest';

import {
  EXPECTED_BOARD_ISSUE_CEILING,
  FEATURE_KEY_CHUNK_SIZE,
  NO_FEATURE_KEY,
  SUBTASK_PARENT_CHUNK_SIZE,
  UNMAPPED_COLUMN_ID,
} from './rollupBoardTypes.ts';

describe('roll-up board constants', () => {
  it('reserves a column id that no Jira-derived column could collide with', () => {
    expect(UNMAPPED_COLUMN_ID).toBe('__unmapped__');
  });

  it('reserves a Feature key that no real Jira key could collide with', () => {
    // Real keys look like ENCUC-1234, so the sentinel must not be mistakable for one.
    expect(NO_FEATURE_KEY).toBe('__no_feature__');
    expect(NO_FEATURE_KEY).not.toMatch(/^[A-Z]+-\d+$/);
  });

  it('sets the board size the design targets', () => {
    expect(EXPECTED_BOARD_ISSUE_CEILING).toBe(300);
  });

  it('keeps the parent sweep chunk small, since one parent can fan out to many sub-tasks', () => {
    expect(SUBTASK_PARENT_CHUNK_SIZE).toBe(50);
    expect(SUBTASK_PARENT_CHUNK_SIZE).toBeLessThanOrEqual(FEATURE_KEY_CHUNK_SIZE);
  });

  it('keeps every chunk size positive, so paging can never loop forever', () => {
    expect(SUBTASK_PARENT_CHUNK_SIZE).toBeGreaterThan(0);
    expect(FEATURE_KEY_CHUNK_SIZE).toBeGreaterThan(0);
  });
});
