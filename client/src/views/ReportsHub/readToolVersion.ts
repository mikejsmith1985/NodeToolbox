// readToolVersion.ts — Reads the running tool version, for a report's provenance line.
//
// Shared by every Reports Hub document so a copied report can state which version produced it. A
// version is provenance, not content: if it cannot be read the report is still produced, labelled
// "unknown", rather than failing.

/** Fetches the current tool version, returning "unknown" rather than throwing when it is unavailable. */
export async function readToolVersion(): Promise<string> {
  try {
    const response = await fetch('/api/version-check');
    const payload = (await response.json()) as { currentVersion?: string; version?: string };
    return payload.currentVersion ?? payload.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
