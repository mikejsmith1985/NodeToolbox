// wizardSettings.ts — The Wizard's own settings (today: the Jira address), kept in the Wizard's browser storage.

import { DEFAULT_JIRA_URL } from '../wizardDefaults.ts';

export const JIRA_URL_STORAGE_KEY = 'snowWizard:jiraUrl';
const INVALID_JIRA_URL_MESSAGE = 'Enter the full Jira address, starting with https://';

/** The outcome of saving the Jira address: saved, or refused with a reason the user can act on. */
export interface SaveJiraUrlResult {
  isSaved: boolean;
  jiraUrl: string;
  problem?: string;
}

/** Turns what the user typed into a clean web address, or null when it is not an http(s) address. */
export function normalizeJiraUrl(addressText: string): string | null {
  try {
    const parsedAddress = new URL(addressText.trim());
    if (parsedAddress.protocol !== 'https:' && parsedAddress.protocol !== 'http:') return null;
    return `${parsedAddress.origin}${parsedAddress.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** The Jira address to use: the saved one, else the built-in default (also when the browser refuses storage). */
export function loadJiraUrl(): string {
  try {
    return normalizeJiraUrl(localStorage.getItem(JIRA_URL_STORAGE_KEY) ?? '') ?? DEFAULT_JIRA_URL;
  } catch {
    return DEFAULT_JIRA_URL;
  }
}

/** Saves a new Jira address when it is a real web address; otherwise keeps the old one and says why. */
export function saveJiraUrl(addressText: string): SaveJiraUrlResult {
  const normalizedUrl = normalizeJiraUrl(addressText);
  if (!normalizedUrl) return { isSaved: false, jiraUrl: loadJiraUrl(), problem: INVALID_JIRA_URL_MESSAGE };
  try {
    localStorage.setItem(JIRA_URL_STORAGE_KEY, normalizedUrl);
  } catch {
    // A browser that refuses storage still uses the new address for this visit.
  }
  return { isSaved: true, jiraUrl: normalizedUrl };
}
