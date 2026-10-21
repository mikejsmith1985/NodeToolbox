// wizardSettings.test.ts — Proves the ServiceNow and Jira address settings start from the built-in defaults, accept only
// real web addresses, and survive a browser that refuses storage.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_JIRA_URL, DEFAULT_SNOW_URL } from '../wizardDefaults.ts';
import {
  JIRA_URL_STORAGE_KEY,
  loadJiraUrl,
  loadSnowUrl,
  normalizeAddress,
  normalizeJiraUrl,
  saveJiraUrl,
  saveSnowUrl,
  SNOW_URL_STORAGE_KEY,
} from './wizardSettings.ts';

const INVALID_ADDRESS_PROBLEM = 'Enter the full address, starting with https://';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('normalizeAddress', () => {
  it('keeps the address up to its path and drops a trailing slash', () => {
    expect(normalizeAddress('  https://jira.example.com/jira/  ')).toBe('https://jira.example.com/jira');
    expect(normalizeAddress('https://acme.service-now.com/')).toBe('https://acme.service-now.com');
  });

  it('refuses anything that is not an http(s) address', () => {
    expect(normalizeAddress('jira.example.com')).toBeNull();
    expect(normalizeAddress('javascript:alert(1)')).toBeNull();
    expect(normalizeAddress('')).toBeNull();
  });

  it('is the same rule under the Jira name', () => {
    expect(normalizeJiraUrl).toBe(normalizeAddress);
  });
});

describe('loadSnowUrl / saveSnowUrl', () => {
  it('starts from the built-in default', () => {
    expect(loadSnowUrl()).toBe(DEFAULT_SNOW_URL);
  });

  it('remembers a saved address', () => {
    expect(saveSnowUrl('https://acme.service-now.com/')).toEqual({ isSaved: true, address: 'https://acme.service-now.com' });
    expect(localStorage.getItem(SNOW_URL_STORAGE_KEY)).toBe('https://acme.service-now.com');
    expect(loadSnowUrl()).toBe('https://acme.service-now.com');
  });

  it('refuses an invalid address with a plain reason and keeps the old one', () => {
    saveSnowUrl('https://acme.service-now.com');
    expect(saveSnowUrl('acme')).toEqual({ isSaved: false, address: 'https://acme.service-now.com', problem: INVALID_ADDRESS_PROBLEM });
    expect(loadSnowUrl()).toBe('https://acme.service-now.com');
  });

  it('never mixes the two addresses', () => {
    saveSnowUrl('https://acme.service-now.com');
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
  });
});

describe('loadJiraUrl / saveJiraUrl', () => {
  it('starts from the built-in default', () => {
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
  });

  it('remembers a saved address, also under the Jira name', () => {
    expect(saveJiraUrl('https://jira-new.example.com/')).toEqual({ isSaved: true, address: 'https://jira-new.example.com', jiraUrl: 'https://jira-new.example.com' });
    expect(localStorage.getItem(JIRA_URL_STORAGE_KEY)).toBe('https://jira-new.example.com');
    expect(loadJiraUrl()).toBe('https://jira-new.example.com');
  });

  it('refuses an invalid address with a plain reason and keeps the old one', () => {
    expect(saveJiraUrl('not an address')).toEqual({ isSaved: false, address: DEFAULT_JIRA_URL, jiraUrl: DEFAULT_JIRA_URL, problem: INVALID_ADDRESS_PROBLEM });
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
  });

  it('falls back to the defaults when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadJiraUrl()).toBe(DEFAULT_JIRA_URL);
    expect(loadSnowUrl()).toBe(DEFAULT_SNOW_URL);
  });

  it('still uses a new address for this visit when storage refuses to save it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveJiraUrl('https://jira-new.example.com')).toEqual(expect.objectContaining({ isSaved: true, address: 'https://jira-new.example.com' }));
  });
});
