// componentResolve.test.ts — Component name→id resolution for a project (spec 031, M3).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('./jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { resolveComponentIdsByName } from './componentResolve.ts';

beforeEach(() => {
  mockJiraGet.mockReset();
});

describe('resolveComponentIdsByName', () => {
  it('maps names to ids (case-insensitive) and reports unresolved names', async () => {
    mockJiraGet.mockResolvedValue([
      { id: '101', name: 'payments-api' },
      { id: '102', name: 'UI-Web' },
    ]);

    const result = await resolveComponentIdsByName('DENP', ['PAYMENTS-API', 'ui-web', 'ghost-repo']);

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/project/DENP/components');
    expect(result.ids).toEqual([
      { name: 'payments-api', id: '101' },
      { name: 'UI-Web', id: '102' },
    ]);
    expect(result.unresolved).toEqual(['ghost-repo']);
  });

  it('resolves nothing when the project has no components', async () => {
    mockJiraGet.mockResolvedValue([]);
    const result = await resolveComponentIdsByName('DENP', ['payments-api']);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual(['payments-api']);
  });
});
