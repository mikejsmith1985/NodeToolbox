// wizardSettings.ts — The Wizard's own settings (the ServiceNow and Jira addresses), kept in the browser's storage for
// this file, so they are entered once.

import { DEFAULT_JIRA_URL, DEFAULT_SNOW_URL } from '../wizardDefaults.ts';

export const SNOW_URL_STORAGE_KEY = 'snowWizard:snowUrl';
export const JIRA_URL_STORAGE_KEY = 'snowWizard:jiraUrl';
const INVALID_ADDRESS_MESSAGE = 'Enter the full address, starting with https://';

/** The outcome of saving an address: saved, or refused with a reason the user can act on. */
export interface SaveAddressResult {
  isSaved: boolean;
  address: string;
  problem?: string;
}

/** Kept for callers that name the Jira case. */
export type SaveJiraUrlResult = SaveAddressResult & { jiraUrl: string };

/** Turns what the user typed into a clean web address, or null when it is not an http(s) address. */
export function normalizeAddress(addressText: string): string | null {
  try {
    const parsedAddress = new URL(addressText.trim());
    if (parsedAddress.protocol !== 'https:' && parsedAddress.protocol !== 'http:') return null;
    return `${parsedAddress.origin}${parsedAddress.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Same as `normalizeAddress`, under the name the Jira callers use. */
export const normalizeJiraUrl = normalizeAddress;

function loadAddress(storageKey: string, defaultAddress: string): string {
  try {
    return normalizeAddress(localStorage.getItem(storageKey) ?? '') ?? defaultAddress;
  } catch {
    return defaultAddress;
  }
}

function saveAddress(storageKey: string, addressText: string, defaultAddress: string): SaveAddressResult {
  const normalizedAddress = normalizeAddress(addressText);
  if (!normalizedAddress) return { isSaved: false, address: loadAddress(storageKey, defaultAddress), problem: INVALID_ADDRESS_MESSAGE };
  try {
    localStorage.setItem(storageKey, normalizedAddress);
  } catch {
    // A browser that refuses storage still uses the new address for this visit.
  }
  return { isSaved: true, address: normalizedAddress };
}

/** The ServiceNow address to use: the saved one, else the built-in default (also when the browser refuses storage). */
export function loadSnowUrl(): string {
  return loadAddress(SNOW_URL_STORAGE_KEY, DEFAULT_SNOW_URL);
}

/** Saves a new ServiceNow address when it is a real web address; otherwise keeps the old one and says why. */
export function saveSnowUrl(addressText: string): SaveAddressResult {
  return saveAddress(SNOW_URL_STORAGE_KEY, addressText, DEFAULT_SNOW_URL);
}

/** The Jira address to use: the saved one, else the built-in default (also when the browser refuses storage). */
export function loadJiraUrl(): string {
  return loadAddress(JIRA_URL_STORAGE_KEY, DEFAULT_JIRA_URL);
}

/** Saves a new Jira address when it is a real web address; otherwise keeps the old one and says why. */
export function saveJiraUrl(addressText: string): SaveJiraUrlResult {
  const saveResult = saveAddress(JIRA_URL_STORAGE_KEY, addressText, DEFAULT_JIRA_URL);
  return { ...saveResult, jiraUrl: saveResult.address };
}
