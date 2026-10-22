// prbLookups.test.ts — Proves the problem search, the Jira project list, the Epic search and the remembered project.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const snowApiMock = vi.hoisted(() => ({ snowFetch: vi.fn() }));
const jiraApiMock = vi.hoisted(() => ({ jiraGet: vi.fn() }));
vi.mock('../../services/snowApi.ts', () => snowApiMock);
vi.mock('../../services/jiraApi.ts', () => jiraApiMock);

import {
  loadJiraProjects,
  PRB_PROJECT_STORAGE_KEY,
  readRememberedPrbProject,
  rememberPrbProject,
  searchOpenEpics,
  searchProblems,
} from './prbLookups.ts';

function readSnowQuery(): string {
  return decodeURIComponent(snowApiMock.snowFetch.mock.calls[0][0]);
}

function readJql(): string {
  return decodeURIComponent(jiraApiMock.jiraGet.mock.calls[0][0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('searchProblems', () => {
  it('looks a problem number up exactly', async () => {
    snowApiMock.snowFetch.mockResolvedValue({ result: [] });
    await searchProblems(' prb0012345 ');
    expect(readSnowQuery()).toContain('sysparm_query=number=PRB0012345');
  });

  it('searches words in the number and short description', async () => {
    snowApiMock.snowFetch.mockResolvedValue({ result: [] });
    await searchProblems('login^timeout');
    expect(readSnowQuery()).toContain('numberLIKElogin timeout^ORshort_descriptionLIKElogin timeout');
  });

  it('returns each problem with its number, short description, state and description', async () => {
    snowApiMock.snowFetch.mockResolvedValue({
      result: [{
        sys_id: { value: 'abc', display_value: 'abc' },
        number: { value: 'PRB1', display_value: 'PRB1' },
        short_description: { display_value: 'Broken' },
        description: { display_value: 'Long text' },
        state: { value: '101', display_value: 'Assess' },
      }],
    });
    expect(await searchProblems('PRB1')).toEqual([
      { sysId: 'abc', number: 'PRB1', shortDescription: 'Broken', description: 'Long text', stateLabel: 'Assess' },
    ]);
  });

  it('runs no search for empty text', async () => {
    expect(await searchProblems('  ')).toEqual([]);
    expect(snowApiMock.snowFetch).not.toHaveBeenCalled();
  });
});

describe('loadJiraProjects', () => {
  it('lists Jira projects by key, not by name', async () => {
    jiraApiMock.jiraGet.mockResolvedValue([{ id: '2', key: 'ZZ', name: 'Alpha' }, { id: '1', key: 'AA', name: 'Zeta' }]);
    expect((await loadJiraProjects()).map((project) => project.key)).toEqual(['AA', 'ZZ']);
  });
});

describe('searchOpenEpics', () => {
  it('searches open Epics by words', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({
      issues: [{ key: 'DENP-5', fields: { summary: 'Login rework', status: { name: 'In Progress' }, project: { key: 'DENP' } } }],
    });
    const epics = await searchOpenEpics('login rew');
    expect(readJql()).toContain('issuetype = Epic AND statusCategory != Done AND summary ~ "login rew*"');
    expect(epics).toEqual([{ key: 'DENP-5', summary: 'Login rework', statusName: 'In Progress' }]);
  });

  it('finds an Epic by its key', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({ issues: [] });
    await searchOpenEpics('denp-5');
    expect(readJql()).toContain('key = "DENP-5" AND issuetype = Epic');
  });

  it('runs no search when nothing usable was typed', async () => {
    expect(await searchOpenEpics(' : ')).toEqual([]);
    expect(jiraApiMock.jiraGet).not.toHaveBeenCalled();
  });
});

describe('remembered project', () => {
  it('remembers the last project chosen', () => {
    expect(readRememberedPrbProject()).toBe('');
    rememberPrbProject('ENCUC');
    expect(localStorage.getItem(PRB_PROJECT_STORAGE_KEY)).toBe('ENCUC');
    expect(readRememberedPrbProject()).toBe('ENCUC');
  });
});
