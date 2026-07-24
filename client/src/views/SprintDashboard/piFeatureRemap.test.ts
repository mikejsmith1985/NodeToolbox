// piFeatureRemap.test.ts — Unit tests for Team Dashboard PI carryover remap helpers.

import { describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';

const { mockJiraGet, mockFetchScopedTeamFeatures } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockFetchScopedTeamFeatures: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPut: vi.fn(),
}));

vi.mock('./scopedTeamFeatures.ts', () => ({
  fetchScopedTeamFeatures: mockFetchScopedTeamFeatures,
}));

import {
  buildFeatureRemapSearchPath,
  extractFeatureKeyFromIssue,
  fetchFeatureRemapPiOptions,
  readProgramIncrementValueFromIssue,
  resolvePiFieldUpdateValue,
} from './piFeatureRemap.ts';

function buildJiraIssue(overrides: {
  id?: string;
  key?: string;
  fields?: Partial<JiraIssue['fields']>;
} = {}): JiraIssue {
  return {
    id: overrides.id ?? '1001',
    key: overrides.key ?? 'TBX-101',
    fields: {
      summary: 'Carryover story',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2026-05-01T00:00:00.000Z',
      updated: '2026-05-02T00:00:00.000Z',
      description: null,
      ...overrides.fields,
    } as JiraIssue['fields'],
  };
}


describe('piFeatureRemap helpers', () => {
  it('lists every project PI newest-first and defaults source to the current PI, target to the next PI', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z')); // inside PI 26.3
    mockJiraGet.mockReset();
    mockFetchScopedTeamFeatures.mockReset();
    mockJiraGet.mockImplementation((path: string) => {
      if (decodeURIComponent(path).includes('cf[10301] is not EMPTY')) {
        return Promise.resolve({
          issues: [
            buildJiraIssue({ key: 'A-1', fields: { customfield_10301: 'PI 26.4 (07/30/26 - 09/30/26)' } }),
            buildJiraIssue({ key: 'A-2', fields: { customfield_10301: 'PI 26.3 (05/21/26 - 07/29/26)' } }),
            buildJiraIssue({ key: 'A-3', fields: { customfield_10301: 'PI 26.2 (03/12/26 - 05/20/26)' } }),
          ],
        });
      }
      return Promise.resolve({ issues: [] });
    });

    const piOptions = await fetchFeatureRemapPiOptions('TBX', 'PI 26.3 (05/21/26 - 07/29/26)');

    // Newest-first, and every PI offered so either selector can pick any of them.
    expect(piOptions.allPiNames).toEqual([
      'PI 26.4 (07/30/26 - 09/30/26)',
      'PI 26.3 (05/21/26 - 07/29/26)',
      'PI 26.2 (03/12/26 - 05/20/26)',
    ]);
    // Today is in 26.3; closeout moves its leftovers INTO 26.4 — so the user sees they are on the next PI.
    expect(piOptions.defaultSourcePiName).toBe('PI 26.3 (05/21/26 - 07/29/26)');
    expect(piOptions.defaultTargetPiName).toBe('PI 26.4 (07/30/26 - 09/30/26)');
    // Features are loaded per selected PI, not pre-fetched here.
    expect(mockFetchScopedTeamFeatures).not.toHaveBeenCalled();

    vi.useRealTimers();
  });


  it('builds a Jira search path that targets open child issues under the old feature', () => {
    expect(buildFeatureRemapSearchPath('tbx', 'tbx-123', 'customfield_10108', 'customfield_10301')).toContain(
      encodeURIComponent('project = "TBX" AND statusCategory != Done AND cf[10108] = TBX-123 ORDER BY key ASC'),
    );
  });

  it('falls back to the parent issue key when the configured feature link field is empty', () => {
    const jiraIssue = buildJiraIssue({
      fields: {
        parent: { key: 'TBX-5000' },
      },
    });

    expect(extractFeatureKeyFromIssue(jiraIssue, 'customfield_10108')).toBe('TBX-5000');
  });

  it('reads string and option-shaped program increment values', () => {
    const optionValueIssue = buildJiraIssue({
      fields: {
        customfield_10301: { value: 'PI 26.4' },
      },
    });
    const stringValueIssue = buildJiraIssue({
      fields: {
        customfield_10301: 'PI 26.5',
      },
    });

    expect(readProgramIncrementValueFromIssue(optionValueIssue, 'customfield_10301')).toBe('PI 26.4');
    expect(readProgramIncrementValueFromIssue(stringValueIssue, 'customfield_10301')).toBe('PI 26.5');
  });

  it('prefers an allowed Jira option when edit metadata provides one', () => {
    expect(resolvePiFieldUpdateValue({
      allowedValues: [
        { value: 'PI 26.3' },
        { value: 'PI 26.4' },
      ],
    }, 'PI 26.4')).toEqual({ value: 'PI 26.4' });
  });
});
