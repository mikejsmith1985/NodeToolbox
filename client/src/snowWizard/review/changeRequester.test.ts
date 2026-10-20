// changeRequester.test.ts — Proves the Review job finds who to address the coaching note to, and never fails a review
// because that person could not be read.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { readChangeRequester } from './changeRequester.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const mockedSnowFetch = vi.mocked(snowFetch);

beforeEach(() => {
  mockedSnowFetch.mockReset();
});

describe('readChangeRequester', () => {
  it('reads the requester\'s name and email with a single GET', async () => {
    mockedSnowFetch.mockResolvedValue({ result: [{ 'requested_by.name': 'Smith, Jane', 'requested_by.email': 'jane@example.com' }] });

    const requester = await readChangeRequester(' CHG0012345 ');

    expect(requester).toEqual({ name: 'Smith, Jane', email: 'jane@example.com' });
    const [requestPath, requestOptions] = mockedSnowFetch.mock.calls[0];
    expect(requestPath).toContain(encodeURIComponent('number=CHG0012345'));
    expect(requestOptions).toEqual({ method: 'GET' });
  });

  it('falls back to whoever opened the change when no requester is set', async () => {
    mockedSnowFetch.mockResolvedValue({ result: [{ 'requested_by.name': '', 'opened_by.name': 'Lee, Ann', 'opened_by.email': 'ann@example.com' }] });

    expect(await readChangeRequester('CHG1')).toEqual({ name: 'Lee, Ann', email: 'ann@example.com' });
  });

  it('answers blanks, never an error, when the read fails or finds nothing', async () => {
    mockedSnowFetch.mockRejectedValueOnce(new Error('HTTP 403'));
    expect(await readChangeRequester('CHG1')).toEqual({ name: '', email: '' });

    mockedSnowFetch.mockResolvedValueOnce({ result: [] });
    expect(await readChangeRequester('CHG1')).toEqual({ name: '', email: '' });
  });
});
