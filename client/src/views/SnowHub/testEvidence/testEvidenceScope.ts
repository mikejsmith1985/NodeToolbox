// testEvidenceScope.ts — Choosing the release whose evidence is gathered: a project and a fix version.
//
// A change's own text does not always name its Jira issues (GH #377: the seeded key list came up
// empty), and typing keys by hand is exactly the "pick, don't type" failure this app avoids. The
// release is the fix version, so the section offers that as a dropdown fed from Jira — and this
// module holds the pure decisions behind it: which project to start from, which versions to offer,
// and the JQL that names the release.

import { CRG_WIZARD_STORAGE_KEY } from '../hooks/crgStorageKeys.ts';
import type { RawJiraVersion } from '../../ArtView/piPlan/piPlanReleaseSchedule.ts';

/** Where this section remembers the project key it last gathered evidence for. */
export const TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY = 'tbxTestEvidenceProjectKey';

/** One fix version as the dropdown offers it. */
export interface SelectableVersion {
  name: string;
  label: string;
}

const RELEASED_SUFFIX = ' (released)';

/** Normalizes a key the way Jira holds it: trimmed and upper-cased. */
function normalizeProjectKey(rawKey: string | null | undefined): string {
  return String(rawKey ?? '').trim().toUpperCase();
}

/** The project key the CHG Generator draft is working in, or empty when there is no readable draft. */
function readCrgDraftProjectKey(browserStorage: Storage): string {
  try {
    const draftJson = browserStorage.getItem(CRG_WIZARD_STORAGE_KEY);
    if (draftJson === null) {
      return '';
    }
    const draft = JSON.parse(draftJson) as { projectKey?: unknown };
    return typeof draft.projectKey === 'string' ? normalizeProjectKey(draft.projectKey) : '';
  } catch {
    return '';
  }
}

/**
 * The project key to start from: what this section last used, else the CHG Generator's draft.
 *
 * The operator who just raised a change from a fix version should not have to retype the project
 * to gather that release's evidence. Every read is guarded, because a private window can refuse
 * storage outright.
 */
export function readDefaultProjectKey(browserStorage: Storage): string {
  try {
    const rememberedKey = normalizeProjectKey(browserStorage.getItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY));
    if (rememberedKey !== '') {
      return rememberedKey;
    }
  } catch {
    return '';
  }
  return readCrgDraftProjectKey(browserStorage);
}

/** Remembers the project key for next time, or forgets it when cleared. Storage failures are ignored. */
export function rememberProjectKey(browserStorage: Storage, projectKey: string): void {
  const normalizedKey = normalizeProjectKey(projectKey);
  try {
    if (normalizedKey === '') {
      browserStorage.removeItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY);
    } else {
      browserStorage.setItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY, normalizedKey);
    }
  } catch {
    // Non-fatal: the section still works, it just will not remember.
  }
}

/** Removes the one character that would break a quoted JQL value. */
function stripJqlQuotes(rawValue: string): string {
  return rawValue.replace(/"/g, '');
}

/** The JQL that names one release — the same shape the CHG Generator uses to build its scope. */
export function buildReleaseJql(projectKey: string, fixVersion: string): string {
  return `project = "${stripJqlQuotes(projectKey)}" AND fixVersion = "${stripJqlQuotes(fixVersion)}" ORDER BY key ASC`;
}

/**
 * Turns Jira's version list into dropdown options: unreleased first, released after and labelled,
 * archived never.
 *
 * Evidence is usually gathered before a release ships, but attaching it afterwards is a real thing,
 * so a released version stays selectable. Jira's own order is kept within each group.
 */
export function listSelectableVersions(rawVersions: readonly RawJiraVersion[]): SelectableVersion[] {
  const namedVersions = rawVersions
    .filter((rawVersion) => rawVersion.archived !== true)
    .map((rawVersion) => ({ name: (rawVersion.name ?? '').trim(), isReleased: rawVersion.released === true }))
    .filter((version) => version.name !== '');

  const unreleased = namedVersions.filter((version) => !version.isReleased);
  const released = namedVersions.filter((version) => version.isReleased);

  return [
    ...unreleased.map((version) => ({ name: version.name, label: version.name })),
    ...released.map((version) => ({ name: version.name, label: `${version.name}${RELEASED_SUFFIX}` })),
  ];
}
