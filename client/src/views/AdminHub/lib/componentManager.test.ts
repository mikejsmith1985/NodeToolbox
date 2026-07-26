// componentManager.test.ts — The Jira Component Manager logic: parsing, matching, formatting, and the
// import/remove service flows (jiraApi verbs mocked so no network is touched).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jiraGet: vi.fn(),
  jiraPost: vi.fn(),
  jiraDelete: vi.fn(),
}));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mocks.jiraGet, jiraPost: mocks.jiraPost, jiraDelete: mocks.jiraDelete }));

import {
  bulkRemoveComponents,
  formatComponentsForExport,
  importComponentsToProjects,
  matchComponentsByName,
  parseComponentNames,
  parseProjectKeys,
} from './componentManager.ts';
import type { JiraComponent } from './componentManager.ts';

beforeEach(() => vi.clearAllMocks());

describe('parseComponentNames', () => {
  it('splits on newlines and commas, trims, drops blanks, and de-dupes case-insensitively', () => {
    expect(parseComponentNames('repo-a\n repo-b ,repo-a\n\nREPO-A,repo-c')).toEqual(['repo-a', 'repo-b', 'repo-c']);
  });
});

describe('parseProjectKeys', () => {
  it('upper-cases and de-dupes keys split on space/comma/newline', () => {
    expect(parseProjectKeys('abc, def\ngHi abc')).toEqual(['ABC', 'DEF', 'GHI']);
  });
});

describe('matchComponentsByName', () => {
  const components: JiraComponent[] = [{ id: '1', name: 'repo-a' }, { id: '2', name: 'Repo-B' }];
  it('matches by case-insensitive name and reports unmatched requests', () => {
    const { matched, unmatched } = matchComponentsByName(components, ['REPO-A', 'repo-b', 'missing']);
    expect(matched.map((component) => component.id)).toEqual(['1', '2']);
    expect(unmatched).toEqual(['missing']);
  });
});

describe('formatComponentsForExport', () => {
  it('renders one component name per line', () => {
    expect(formatComponentsForExport([{ id: '1', name: 'a' }, { id: '2', name: 'b' }])).toBe('a\nb');
  });
});

describe('importComponentsToProjects', () => {
  it('skips existing names, creates new ones, and reports per project', async () => {
    mocks.jiraGet.mockResolvedValue([{ id: '1', name: 'repo-a' }]); // repo-a already exists on each project
    mocks.jiraPost.mockResolvedValue({});
    const results = await importComponentsToProjects(['repo-a', 'repo-b'], ['ABC', 'DEF']);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ projectKey: 'ABC', created: ['repo-b'], skipped: ['repo-a'], failed: [] });
    // repo-b created once per project → two POSTs total; repo-a never posted.
    expect(mocks.jiraPost).toHaveBeenCalledTimes(2);
    expect(mocks.jiraPost).toHaveBeenCalledWith('/rest/api/2/component', { name: 'repo-b', project: 'ABC' });
  });

  it('captures a create failure without aborting the rest of the list', async () => {
    mocks.jiraGet.mockResolvedValue([]);
    mocks.jiraPost.mockRejectedValueOnce(new Error('duplicate name')).mockResolvedValue({});
    const [result] = await importComponentsToProjects(['bad', 'good'], ['ABC']);
    expect(result.failed).toEqual([{ name: 'bad', reason: 'duplicate name' }]);
    expect(result.created).toEqual(['good']);
  });
});

describe('bulkRemoveComponents', () => {
  it('deletes matched components and reports unmatched names', async () => {
    mocks.jiraGet.mockResolvedValue([{ id: '10', name: 'repo-a' }, { id: '11', name: 'repo-b' }]);
    mocks.jiraDelete.mockResolvedValue(undefined);
    const result = await bulkRemoveComponents('ABC', ['repo-a', 'missing']);

    expect(mocks.jiraDelete).toHaveBeenCalledTimes(1);
    expect(mocks.jiraDelete).toHaveBeenCalledWith('/rest/api/2/component/10');
    expect(result.deleted.map((component) => component.name)).toEqual(['repo-a']);
    expect(result.unmatched).toEqual(['missing']);
  });
});
