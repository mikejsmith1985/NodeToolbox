// myOpenChanges.test.ts — Proves the user's open changes are read with Modify CHG's own query and come back as number + title.

import { describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { buildMyOpenChangesPath, fetchMyOpenChanges, MY_OPEN_CHANGES_QUERY } from './myOpenChanges.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

describe('fetchMyOpenChanges', () => {
  it('asks for the signed-in user\'s active changes and reads number and title', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce({ result: [
      { number: { value: 'CHG0052018', display_value: 'CHG0052018' }, short_description: { value: 'PRD release', display_value: 'PRD release' } },
      { number: 'CHG0052017', short_description: 'REL release' },
      { number: '', short_description: 'broken row' },
    ] } as never);
    expect(await fetchMyOpenChanges()).toEqual([
      { changeNumber: 'CHG0052018', shortDescription: 'PRD release' }, { changeNumber: 'CHG0052017', shortDescription: 'REL release' },
    ]);
    expect(decodeURIComponent(buildMyOpenChangesPath())).toContain(MY_OPEN_CHANGES_QUERY);
  });

  it('passes a failed read on, with its reason', async () => {
    vi.mocked(snowFetch).mockRejectedValueOnce(new Error('HTTP 401'));
    await expect(fetchMyOpenChanges()).rejects.toThrow('HTTP 401');
  });
});
