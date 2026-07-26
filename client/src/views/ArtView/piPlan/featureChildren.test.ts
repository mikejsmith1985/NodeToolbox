// featureChildren.test.ts — Reads + classifies a Feature's existing children for idempotency (US6).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ jiraGet: vi.fn() }));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mocks.jiraGet }));

import { classifySubtask, fetchFeatureChildren } from './featureChildren.ts';

beforeEach(() => vi.clearAllMocks());

describe('classifySubtask', () => {
  it('maps the planner-stamped prefixes to sub-task kinds', () => {
    expect(classifySubtask('[IT] Internal Test — Login')).toBe('internalTest');
    expect(classifySubtask('[INT] Deploy to INT — Login')).toBe('deployInt');
    expect(classifySubtask('[REL] Deploy to REL — Login')).toBe('deployRel');
    expect(classifySubtask('[PROD] Deploy to PROD — Login')).toBe('deployProd');
    expect(classifySubtask('Something else')).toBe('unknown');
  });
});

describe('fetchFeatureChildren', () => {
  it('flattens child Stories and their sub-tasks into classified ExistingChild records', async () => {
    mocks.jiraGet.mockResolvedValue({
      issues: [
        {
          key: 'ABC-10',
          fields: {
            summary: 'Login form',
            issuetype: { name: 'Story' },
            subtasks: [{ key: 'ABC-11', fields: { summary: '[IT] Internal Test — Login form' } }],
          },
        },
      ],
    });
    const children = await fetchFeatureChildren('ABC-1', 'cf[10108]');

    expect(mocks.jiraGet).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('cf[10108] = "ABC-1"')));
    expect(children).toEqual([
      { key: 'ABC-10', kind: 'story', parentKey: 'ABC-1', summary: 'Login form' },
      { key: 'ABC-11', kind: 'internalTest', parentKey: 'ABC-10', summary: '[IT] Internal Test — Login form' },
    ]);
  });
});
