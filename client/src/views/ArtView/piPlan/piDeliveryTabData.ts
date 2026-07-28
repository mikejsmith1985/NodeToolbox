// piDeliveryTabData.ts — Pure adapters that turn what the PI Delivery tab can fetch/read (Jira Feature
// issues, the roster) into the deterministic fact-sheet inputs the engine consumes (spec 032, US1). Kept
// pure and separate from the React tab so the mapping is unit-testable and the tab stays declarative.

import type { JiraIssue } from '../../../types/jira.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { FactSheetFeatureInput, FactSheetPersonInput } from './piPlanFactSheet.ts';
import type { ExistingChild, ReleaseSchedule } from './piPlanTypes.ts';

/** A person's default per-sprint velocity when no measured value is available (a plain 2-week pool). */
const DEFAULT_VELOCITY_POINTS = 8;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Reads a numeric size from a Jira issue's configured size field, or null when absent/non-numeric. */
function readSizePoints(issue: JiraIssue, sizeFieldId: string): number | null {
  const raw = (issue.fields as unknown as Record<string, unknown>)[sizeFieldId];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  // Jira number custom fields sometimes arrive as strings; accept a clean numeric string.
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

/** Extracts the "blocks/depends-on" outward issue keys from a Jira issue's links (best-effort). */
function readDependencyKeys(issue: JiraIssue): string[] {
  const links = (issue.fields as unknown as { issuelinks?: unknown }).issuelinks;
  if (!Array.isArray(links)) {
    return [];
  }
  const keys: string[] = [];
  for (const link of links) {
    const outward = (link as { outwardIssue?: { key?: string } }).outwardIssue;
    if (outward?.key) {
      keys.push(outward.key);
    }
  }
  return keys;
}

/**
 * Maps a list of Jira Feature issues into fact-sheet Feature inputs: key, summary, size (from the configured
 * field), component names (the raw components — classification into repo/domain happens in the assembler),
 * priority name, target fixVersion, and dependency keys. Committed is inferred from the size being present
 * (an unsized Feature is surfaced as a note downstream); the caller may override.
 */
export function toFactSheetFeatureInputs(
  issues: JiraIssue[],
  sizeFieldId: string,
  priorityRankByKey: Record<string, number> = {},
  existingChildrenByFeatureKey: Record<string, ExistingChild[]> = {},
): FactSheetFeatureInput[] {
  return issues.map((issue, index) => {
    const rawComponents = (issue.fields as unknown as { components?: unknown }).components;
    const componentNames = Array.isArray(rawComponents)
      ? rawComponents.map((component) => (component as { name?: string }).name ?? '').filter((name: string) => name !== '')
      : [];
    const fixVersions = (issue.fields as unknown as { fixVersions?: { name?: string }[] }).fixVersions;
    const targetFixVersion = Array.isArray(fixVersions) && fixVersions.length > 0 ? (fixVersions[0].name ?? null) : null;
    const priorityName = (issue.fields?.priority as { name?: string } | undefined)?.name ?? null;
    return {
      key: issue.key,
      summary: typeof issue.fields?.summary === 'string' ? issue.fields.summary : issue.key,
      sizePoints: readSizePoints(issue, sizeFieldId),
      priorityRank: priorityRankByKey[issue.key] ?? index,
      priorityName,
      isCommitted: true,
      componentNames,
      dependencyKeys: readDependencyKeys(issue),
      targetFixVersion,
      existingChildren: existingChildrenByFeatureKey[issue.key] ?? [],
    };
  });
}

/** Maps a roster member's capability flags to the three delivery role strings the planner schedules against. */
export function rosterRolesFor(member: StandupRosterMember): string[] {
  const capabilities = member.roleCapabilities;
  const roles: string[] = [];
  if (capabilities?.canDevelop) roles.push('dev');
  if (capabilities?.canInternalTest) roles.push('internalTest');
  if (capabilities?.canExternalTest) roles.push('externalTest');
  return roles;
}

/**
 * Maps roster members into fact-sheet person inputs, keeping only those with at least one delivery role.
 * Velocity defaults to a flat per-sprint pool unless a measured value is supplied by the caller.
 */
export function toFactSheetPersonInputs(
  members: StandupRosterMember[],
  velocityByName: Record<string, number> = {},
): FactSheetPersonInput[] {
  return members
    .map((member) => ({ member, roles: rosterRolesFor(member) }))
    .filter((entry) => entry.roles.length > 0)
    .map((entry) => ({
      displayName: entry.member.displayName,
      accountId: (entry.member as unknown as { accountId?: string | null }).accountId ?? null,
      roles: entry.roles,
      velocity: velocityByName[entry.member.displayName] ?? DEFAULT_VELOCITY_POINTS,
    }));
}

/** One Jira project version (fixVersion) as returned by /rest/api/2/project/{key}/versions. */
export interface JiraProjectVersion {
  name?: string;
  releaseDate?: string;
  archived?: boolean;
}

/**
 * Builds the production release schedule from a project's fixVersions: every non-archived version that has a
 * release date, as a dated, sorted entry. This is how the delivery process **determines the correct
 * fixVersion** — the date engine lands each Story's PROD/Due on the first release on/after it, rather than
 * trusting a Feature's fixVersion that may be unset at load time. Pure.
 */
export function versionsToReleaseSchedule(versions: JiraProjectVersion[]): ReleaseSchedule {
  const entries = versions
    .filter((version) => !version.archived && typeof version.releaseDate === 'string' && version.releaseDate !== '')
    .map((version) => ({ name: (version.name ?? '').trim(), releaseDateIso: (version.releaseDate as string).slice(0, 10), isSuggested: false }))
    .filter((entry) => entry.name !== '')
    .sort((left, right) => left.releaseDateIso.localeCompare(right.releaseDateIso));
  return { entries };
}

/** Derives `count` evenly-spaced sprint windows across the PI, when the board does not already supply them. */
export function deriveSprints(
  piStartIso: string,
  piEndIso: string,
  count: number,
  piName: string,
): { name: string; startIso: string; endIso: string }[] {
  const start = Date.parse(piStartIso.slice(0, 10) + 'T00:00:00Z');
  const end = Date.parse(piEndIso.slice(0, 10) + 'T00:00:00Z');
  const safeCount = Math.max(1, count);
  const spanDays = Math.max(safeCount, Math.round((end - start) / MILLISECONDS_PER_DAY));
  const daysPerSprint = Math.floor(spanDays / safeCount);
  return Array.from({ length: safeCount }, (_unused, index) => {
    const sprintStart = start + index * daysPerSprint * MILLISECONDS_PER_DAY;
    const sprintEnd = start + ((index + 1) * daysPerSprint - 1) * MILLISECONDS_PER_DAY;
    return {
      name: `${piName}.${index + 1}`,
      startIso: new Date(sprintStart).toISOString().slice(0, 10),
      endIso: new Date(sprintEnd).toISOString().slice(0, 10),
    };
  });
}
