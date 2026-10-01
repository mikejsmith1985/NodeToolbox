// releaseDocumentParentStore.ts — Remembers each team's release-document parent page (feature 038).
//
// Kept apart from the release-notes parent (tbxReleaseNotesConfluenceParents): the two are different page
// trees, and sharing one parent would mix them. The `tbx` prefix puts it in Settings Backup.

const PARENT_PAGE_STORAGE_KEY = 'tbxReleaseDocumentParents';

/** Every team's remembered parent page, or an empty map when nothing readable is stored. */
function readStoredParents(): Record<string, string> {
  try {
    const storedValue = window.localStorage.getItem(PARENT_PAGE_STORAGE_KEY);
    const parsedValue: unknown = storedValue === null ? {} : JSON.parse(storedValue);
    return parsedValue !== null && typeof parsedValue === 'object' ? parsedValue as Record<string, string> : {};
  } catch {
    // Blocked storage or a corrupted value both mean "nothing remembered" — the person pastes it again.
    return {};
  }
}

/** The parent page this team's release documents are created under, or '' when none was chosen. */
export function readReleaseDocumentParent(teamProfileId: string): string {
  const storedReference = readStoredParents()[teamProfileId];
  return typeof storedReference === 'string' ? storedReference : '';
}

/** Remembers (or, when blank, forgets) this team's release-document parent page. */
export function writeReleaseDocumentParent(teamProfileId: string, parentPageReference: string): void {
  const parentPages = readStoredParents();
  const trimmedReference = parentPageReference.trim();
  if (trimmedReference === '') {
    delete parentPages[teamProfileId];
  } else {
    parentPages[teamProfileId] = trimmedReference;
  }

  try {
    window.localStorage.setItem(PARENT_PAGE_STORAGE_KEY, JSON.stringify(parentPages));
  } catch {
    // Storage is unavailable (private window); the choice lasts only for this visit.
  }
}
