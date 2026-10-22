// prbProblemStatement.test.ts — The Defect key goes on the end of the Problem statement once, and only once.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { snowFetchMock } = vi.hoisted(() => ({ snowFetchMock: vi.fn() }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: snowFetchMock }));

import { appendDefectKey, stampDefectKeyOnProblem, statementHasDefectKey } from './prbProblemStatement.ts';

describe('appendDefectKey', () => {
  it('adds " - <key>" to the end, as in GH #475', () => {
    expect(appendDefectKey('ENFCT-2125 Post Deploy Fix Needed', 'ENFCT-2175')).toBe('ENFCT-2125 Post Deploy Fix Needed - ENFCT-2175');
  });

  it('leaves a statement that already names the key alone', () => {
    expect(appendDefectKey('Fix Needed - ENFCT-2175', 'ENFCT-2175')).toBe('Fix Needed - ENFCT-2175');
  });

  it('trims trailing spaces before adding, and uses the key alone for an empty statement', () => {
    expect(appendDefectKey('Fix Needed  ', 'ENFCT-1')).toBe('Fix Needed - ENFCT-1');
    expect(appendDefectKey('', 'ENFCT-1')).toBe('ENFCT-1');
  });
});

describe('statementHasDefectKey', () => {
  it('matches the whole key only', () => {
    expect(statementHasDefectKey('Fix - ENFCT-2175', 'ENFCT-217')).toBe(false);
    expect(statementHasDefectKey('Fix - XENFCT-2175', 'ENFCT-2175')).toBe(false);
    expect(statementHasDefectKey('Fix - enfct-2175', 'ENFCT-2175')).toBe(true);
  });
});

describe('stampDefectKeyOnProblem', () => {
  beforeEach(() => snowFetchMock.mockReset());

  it('reads the statement fresh, then writes it with the key on the end', async () => {
    snowFetchMock.mockResolvedValueOnce({ result: { short_description: 'Post Deploy Fix Needed' } }).mockResolvedValueOnce({});

    await expect(stampDefectKeyOnProblem('sys1', 'ENFCT-9')).resolves.toBe('Post Deploy Fix Needed - ENFCT-9');

    expect(snowFetchMock.mock.calls[0][0]).toBe('/api/now/table/problem/sys1?sysparm_fields=short_description');
    expect(snowFetchMock.mock.calls[1][0]).toBe('/api/now/table/problem/sys1');
    expect(snowFetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ short_description: 'Post Deploy Fix Needed - ENFCT-9' }) });
  });

  it('writes nothing when the key is already there', async () => {
    snowFetchMock.mockResolvedValueOnce({ result: { short_description: 'Fix - ENFCT-9' } });

    await expect(stampDefectKeyOnProblem('sys1', 'ENFCT-9')).resolves.toBe('Fix - ENFCT-9');
    expect(snowFetchMock).toHaveBeenCalledTimes(1);
  });
});
