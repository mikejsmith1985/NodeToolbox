// componentResolve.test.ts — Component name→id resolution for a project (spec 031, M3).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockJiraPut } = vi.hoisted(() => ({ mockJiraGet: vi.fn(), mockJiraPut: vi.fn() }));
vi.mock('./jiraApi.ts', () => ({ jiraGet: mockJiraGet, jiraPut: mockJiraPut }));

import { addIssueComponentsByName, resolveComponentIdsByName } from './componentResolve.ts';

beforeEach(() => {
  mockJiraGet.mockReset();
  mockJiraPut.mockReset();
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

describe('addIssueComponentsByName', () => {
  it('unions new component names with the issue\'s existing ones (never blanks)', async () => {
    mockJiraGet.mockResolvedValue({ fields: { components: [{ name: 'Enrollment' }] } });
    await addIssueComponentsByName('DENP-1', ['payments-api', 'Enrollment']);
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1?fields=components');
    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1', {
      fields: { components: [{ name: 'Enrollment' }, { name: 'payments-api' }] },
    });
  });

  it('does nothing (no write) when there are no names to add', async () => {
    await addIssueComponentsByName('DENP-1', []);
    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(mockJiraPut).not.toHaveBeenCalled();
  });
});
