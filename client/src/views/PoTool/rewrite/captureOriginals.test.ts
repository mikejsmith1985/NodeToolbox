// captureOriginals.test.ts — Key parsing + per-issue capture with per-key error isolation (spec 030, US1).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ jiraGet: vi.fn() }));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mocks.jiraGet }));

import { captureOriginals, parseIssueKeys } from './captureOriginals.ts';

beforeEach(() => vi.clearAllMocks());

describe('parseIssueKeys', () => {
  it('upper-cases, de-dupes, and drops blanks across newlines/commas/spaces', () => {
    expect(parseIssueKeys('abc-1, abc-2\nabc-1  DENP-9')).toEqual(['ABC-1', 'ABC-2', 'DENP-9']);
  });
});

describe('captureOriginals', () => {
  it('captures normalized summary/description/AC per key', async () => {
    mocks.jiraGet.mockImplementation(async (path: string) => {
      const key = path.includes('ABC-1') ? 'ABC-1' : 'ABC-2';
      return { fields: { summary: `${key} title`, description: `${key} desc`, customfield_10200: `${key} ac` } };
    });
    const items = await captureOriginals(['ABC-1', 'ABC-2'], 'customfield_10200');
    expect(items.map((item) => item.jiraKey)).toEqual(['ABC-1', 'ABC-2']);
    expect(items[0].original.summary).toBe('ABC-1 title');
    expect(items[0].original.acceptanceCriteria).toBe('ABC-1 ac');
    expect(items[0].state).toBe('captured');
    expect(items[0].captureError).toBeNull();
    expect(typeof items[0].original.capturedAtIso).toBe('string');
  });

  it('records a captureError for an unreachable key without failing the rest', async () => {
    mocks.jiraGet.mockImplementation(async (path: string) => {
      if (path.includes('BAD-9')) throw new Error('Issue does not exist');
      return { fields: { summary: 'ok', description: 'd', customfield_10200: 'a' } };
    });
    const items = await captureOriginals(['BAD-9', 'ABC-1'], 'customfield_10200');
    expect(items[0].captureError).toMatch(/does not exist/);
    expect(items[0].original.summary).toBe('');
    expect(items[1].captureError).toBeNull();
    expect(items[1].original.summary).toBe('ok');
  });
});
