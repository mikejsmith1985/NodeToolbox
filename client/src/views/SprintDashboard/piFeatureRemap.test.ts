// piFeatureRemap.test.ts — Unit tests for Team Dashboard PI carryover remap helpers.

import { describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';
import type { BlueprintFeatureNode } from '../ArtView/blueprintHierarchy.ts';

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

function buildFeatureNode(key: string, summary: string): BlueprintFeatureNode {
  return {
    type: 'feature',
    key,
    summary,
    status: 'In Progress',
    health: 'green',
    completionPercent: 50,
    children: [{ key: 'TBX-1' }] as BlueprintFeatureNode['children'],
    offTrain: [],
    isExternal: true,
  };
}

describe('piFeatureRemap helpers', () => {
  it('discovers prior and current PI features from linked team issues instead of project-scoped feature queries', async () => {
    mockJiraGet.mockReset();
    mockFetchScopedTeamFeatures.mockReset();
    mockJiraGet.mockImplementation((path: string) => {
      const decodedPath = decodeURIComponent(path);
      if (decodedPath.includes('project = "TBX" AND cf[10301] is not EMPTY')) {
        return Promise.resolve({
          issues: [
            buildJiraIssue({ fields: { customfield_10301: 'PI 26.3 (05/01/26 - 06/30/26)' } }),
            buildJiraIssue({ key: 'TBX-102', fields: { customfield_10301: 'PI 26.2 (02/01/26 - 04/30/26)' } }),
          ],
        });
      }

      if (decodedPath.includes('project = "TBX" AND cf[10301] = "PI 26.2 (02/01/26 - 04/30/26)"')) {
        return Promise.resolve({
          issues: [
            buildJiraIssue({
              key: 'TBX-201',
              fields: {
                summary: 'Prior PI carryover story',
                customfield_10108: 'ART-5000',
              },
            }),
          ],
        });
      }

      if (decodedPath.includes('project = "TBX" AND cf[10301] = "PI 26.3 (05/01/26 - 06/30/26)"')) {
        return Promise.resolve({
          issues: [
            buildJiraIssue({
              key: 'TBX-301',
              fields: {
                summary: 'Current PI carryover story',
                customfield_10108: 'ART-6000',
              },
            }),
          ],
        });
      }

      if (decodedPath.includes('key in (ART-5000)')) {
        return Promise.resolve({
          issues: [
            buildJiraIssue({
              key: 'ART-5000',
              fields: {
                summary: 'Prior PI external feature',
                issuetype: { name: 'Feature', iconUrl: '' },
              },
            }),
          ],
        });
      }

      if (decodedPath.includes('key in (ART-6000)')) {
        return Promise.resolve({
          issues: [
            buildJiraIssue({
              key: 'ART-6000',
              fields: {
                summary: 'Current PI external feature',
                issuetype: { name: 'Feature', iconUrl: '' },
              },
            }),
          ],
        });
      }

      if (decodedPath.includes('"Epic Link" in (ART-5000)') || decodedPath.includes('"Epic Link" in (ART-6000)')) {
        return Promise.resolve({ issues: [] });
      }

      if (decodedPath.includes('parent in (TBX-201)') || decodedPath.includes('parent in (TBX-301)')) {
        return Promise.resolve({ issues: [] });
      }

      return Promise.resolve({ issues: [] });
    });
    mockFetchScopedTeamFeatures
      .mockResolvedValueOnce([
        {
          feature: buildFeatureNode('ART-5000', 'Prior PI external feature'),
          featureIssue: buildJiraIssue({
            key: 'ART-5000',
            fields: {
              summary: 'Prior PI external feature',
              issuetype: { name: 'Feature', iconUrl: '' },
              customfield_10301: 'PI 26.2 (02/01/26 - 04/30/26)',
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        {
          feature: buildFeatureNode('ART-6000', 'Current PI external feature'),
          featureIssue: buildJiraIssue({
            key: 'ART-6000',
            fields: {
              summary: 'Current PI external feature',
              issuetype: { name: 'Feature', iconUrl: '' },
              customfield_10301: 'PI 26.3 (05/01/26 - 06/30/26)',
            },
          }),
        },
      ]);

    const piOptions = await fetchFeatureRemapPiOptions('TBX', 'PI 26.3 (05/01/26 - 06/30/26)');

    expect(piOptions.priorPiFeatures).toEqual([
      { key: 'ART-5000', summary: 'Prior PI external feature', piValue: 'PI 26.2 (02/01/26 - 04/30/26)' },
    ]);
    expect(piOptions.currentPiFeatures).toEqual([
      { key: 'ART-6000', summary: 'Current PI external feature', piValue: 'PI 26.3 (05/01/26 - 06/30/26)' },
    ]);
    expect(
      mockJiraGet.mock.calls.some(([path]) =>
        decodeURIComponent(String(path)).includes('issuetype in ("Feature", "Epic")'),
      ),
    ).toBe(false);
    expect(mockFetchScopedTeamFeatures).toHaveBeenCalledTimes(2);
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
