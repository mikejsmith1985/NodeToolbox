// sharePointSiteUrl.ts — Shares the SharePoint intake site reference between Intake settings (where
// the user configures it) and other surfaces that can't read the intake config directly: the
// Connection Bar's "Open SharePoint" button and the Admin Hub relay diagnostics. Bridged via
// localStorage. The openable site URL is only stored when it is a full http(s) URL (a bare
// site-relative path has no host to open); the list name is stored as-is for diagnostics.

const SHAREPOINT_SITE_URL_KEY = 'tbxSharePointSiteUrl';
const SHAREPOINT_LIST_NAME_KEY = 'tbxSharePointListName';
const FULL_URL_PATTERN = /^https?:\/\//i;

/** Persists the SharePoint site URL when it is a full http(s) URL; clears it otherwise. */
export function saveSharePointSiteUrl(siteUrl: string | undefined | null): void {
  if (siteUrl && FULL_URL_PATTERN.test(siteUrl.trim())) {
    localStorage.setItem(SHAREPOINT_SITE_URL_KEY, siteUrl.trim());
  } else {
    localStorage.removeItem(SHAREPOINT_SITE_URL_KEY);
  }
}

/** Returns the stored full SharePoint site URL, or null when none/invalid is stored. */
export function readSharePointSiteUrl(): string | null {
  const stored = localStorage.getItem(SHAREPOINT_SITE_URL_KEY);
  return stored && FULL_URL_PATTERN.test(stored) ? stored : null;
}

/** Persists the SharePoint list name for the Admin Hub diagnostics; clears it when empty. */
export function saveSharePointListName(listName: string | undefined | null): void {
  if (listName && listName.trim() !== '') {
    localStorage.setItem(SHAREPOINT_LIST_NAME_KEY, listName.trim());
  } else {
    localStorage.removeItem(SHAREPOINT_LIST_NAME_KEY);
  }
}

/** Returns the stored SharePoint list name, or null when none is stored. */
export function readSharePointListName(): string | null {
  const stored = localStorage.getItem(SHAREPOINT_LIST_NAME_KEY);
  return stored && stored.trim() !== '' ? stored : null;
}
