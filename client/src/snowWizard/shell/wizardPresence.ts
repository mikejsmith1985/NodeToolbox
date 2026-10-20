// wizardPresence.ts — Lets a second bookmark click know the Wizard is already open, and points the user at its tab.
//
// ServiceNow's pop-up isolation puts the Wizard in its own window group, so the ServiceNow tab cannot find or focus it
// by name. A Web Lock is the browser's own "someone of this site holds this" record — readable even while the Wizard tab
// is asleep — so the bookmark checks it before opening anything (Art VII: the platform primitive, nothing custom).

/** The pointer shown in the tab title so the user can spot the open Wizard among their tabs. */
const FLAGGED_TITLE_SUFFIX = ' — over here';
const FLAGGED_TITLE_PREFIX = '👉 ';
const DEFAULT_FLAG_DURATION_MS = 8000;

/** Holds the named lock for as long as this window lives; the browser frees it when the window closes. */
export function holdWizardPresenceLock(lockName: string, lockManager: LockManager | undefined): void {
  if (!lockManager) return;
  void lockManager.request(lockName, () => new Promise<never>(() => undefined)).catch(() => undefined);
}

/** Marks the tab title for a few seconds, because a background tab cannot bring itself to the front. */
export function flagWizardTab(targetDocument: { title: string }, durationMs: number = DEFAULT_FLAG_DURATION_MS): void {
  if (targetDocument.title.startsWith(FLAGGED_TITLE_PREFIX)) return;
  const originalTitle = targetDocument.title;
  targetDocument.title = `${FLAGGED_TITLE_PREFIX}${originalTitle}${FLAGGED_TITLE_SUFFIX}`;
  setTimeout(() => {
    targetDocument.title = originalTitle;
  }, durationMs);
}
