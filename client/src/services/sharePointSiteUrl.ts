// sharePointSiteUrl.ts — Shares the full SharePoint site URL between Intake settings (which the user
// configures) and the Connection Bar (which offers an "Open SharePoint" button). The Connection Bar
// is global and does not read the intake config, so the full URL is bridged via localStorage. Only a
// full http(s) URL is stored — a bare site-relative path cannot be opened (no host).

const SHAREPOINT_SITE_URL_KEY = 'tbxSharePointSiteUrl';
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
