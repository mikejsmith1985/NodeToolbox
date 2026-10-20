// wizardSettings.test.ts — Proves the Jira address setting starts from the built-in default, accepts only real web
// addresses, and survives a browser that refuses storage.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_JIRA_URL } from '../wizardDefaults.ts';
import { JIRA_URL_STORAGE_KEY, loadJiraUrl, normalizeJiraUrl, saveJiraUrl } from './wizardSettings.ts';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('normalizeJiraUrl', () => {
  it('keeps the address up to its path and drops a trailing slash', () => {
    expect(normalizeJiraUrl('  https://jira.example.com/jira/  ')).toBe('https://jira.example.com/jira');
    expect(normalizeJiraUrl('https://jira.example.com/')).toBe('https://jira.example.com');
  });

  it('refuses anything that is not an http(s) address', () => {
    expect(normalizeJiraUrl('jira.example.com')).toBeNull();
    expect(normalizeJiraUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeJiraUrl('')).toBeNull();
  });
});

describe('loadJiraUrl / saveJiraUrl', () => {
  it('starts from the built-in default', () => {
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
  });

  it('remembers a saved address', () => {
    expect(saveJiraUrl('https://jira-new.example.com/')).toEqual({ isSaved: true, jiraUrl: 'https://jira-new.example.com' });
    expect(localStorage.getItem(JIRA_URL_STORAGE_KEY)).toBe('https://jira-new.example.com');
    expect(loadJiraUrl()).toBe('https://jira-new.example.com');
  });

  it('refuses an invalid address with a plain reason and keeps the old one', () => {
    expect(saveJiraUrl('not an address')).toEqual({ isSaved: false, jiraUrl: DEFAULT_JIRA_URL, problem: 'Enter the full Jira address, starting with https://' });
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
  });

  it('falls back to the default when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
  });
});
