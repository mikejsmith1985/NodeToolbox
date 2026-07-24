// carryoverEstimateFetch.ts — Fetches the child issues a carried Feature needs for its remaining-points estimate.
//
// The estimate itself (carryoverEstimate.ts) is pure; this is its one Jira read. For a set of carried
// Feature keys it pulls every child linked to them, shapes each into the estimator's child form, and
// groups them by Feature. Children link to their Feature through the configured Feature-Link field —
// the same field the Blueprint tab groups by — so a child is attributed to its Feature identically here.
//
// The only enrichment is the assignee-role fallback: when a child's summary does not say Dev / SL / QA,
// the estimator falls back to the assignee's roster capability, which this module resolves from the
// roster so the pure estimator never has to know about roster shapes.

import { jiraGet } from '../../services/jiraApi.ts';
import { loadConfiguredFeatureLinkFieldId, extractFeatureKeyFromIssueFields } from '../../utils/featureLink.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { CarryoverChildIssue, CarryoverChildKind } from './carryoverEstimate.ts';

/** Jira caps `in (...)` list length; batch the Feature keys to stay within it. */
const FEATURE_KEY_BATCH_SIZE = 40;

/** Story-points fields to read a child's points from, best-first (dropdown or numeric). */
const STORY_POINTS_FIELD_IDS = ['customfield_10028', 'customfield_10016'] as const;

interface RawAssignee {
  displayName?: string;
  name?: string;
  accountId?: string;
}

interface RawChildIssue {
  key?: string;
  fields?: Record<string, unknown> & {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: RawAssignee | null;
  };
}

/** Quotes a JQL string value, escaping embedded quotes. */
function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Reads a child's story points from whichever field this instance uses, unwrapping a dropdown option. */
function readChildStoryPoints(fields: RawChildIssue['fields']): number | null {
  if (!fields) return null;
  for (const fieldId of STORY_POINTS_FIELD_IDS) {
    const rawValue = fields[fieldId];
    if (typeof rawValue === 'number') return rawValue;
    if (typeof rawValue === 'object' && rawValue !== null) {
      const optionLabel = (rawValue as { value?: string }).value;
      const numericLabel = Number(optionLabel);
      if (Number.isFinite(numericLabel)) return numericLabel;
    }
  }
  return null;
}

/**
 * Builds a resolver from a roster member's identity to their dev/test capability.
 *
 * A member who can do internal testing maps to 'test', one who develops to 'dev'. Only used as the
 * fallback when a child's summary is silent about which kind of work it is.
 */
function buildAssigneeRoleResolver(
  rosterMembers: readonly StandupRosterMember[],
): (assignee: RawAssignee | null) => CarryoverChildKind | null {
  const roleByIdentifier = new Map<string, CarryoverChildKind>();
  for (const member of rosterMembers) {
    const kind: CarryoverChildKind | null = member.roleCapabilities?.canInternalTest
      ? 'test'
      : member.roleCapabilities?.canDevelop
        ? 'dev'
        : null;
    if (kind === null) continue;
    [member.assigneeQueryValue, member.displayName, member.jiraAccountId]
      .map((identifier) => identifier?.trim().toLowerCase())
      .filter((identifier): identifier is string => Boolean(identifier))
      .forEach((identifier) => roleByIdentifier.set(identifier, kind));
  }

  return (assignee) => {
    if (!assignee) return null;
    for (const candidate of [assignee.displayName, assignee.name, assignee.accountId]) {
      const normalized = candidate?.trim().toLowerCase();
      if (normalized && roleByIdentifier.has(normalized)) return roleByIdentifier.get(normalized) ?? null;
    }
    return null;
  };
}

/** Splits Feature keys into batches small enough for one JQL `in (...)` clause. */
function batchFeatureKeys(featureKeys: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < featureKeys.length; index += FEATURE_KEY_BATCH_SIZE) {
    batches.push(featureKeys.slice(index, index + FEATURE_KEY_BATCH_SIZE));
  }
  return batches;
}

/**
 * Fetches the children of the given carried Features and returns them grouped by Feature key.
 *
 * Empty keys and Features with no children simply produce no entry, so a caller can look each key up
 * and treat a miss as "no children found" without special-casing.
 */
export async function fetchCarryoverChildrenByFeature(
  featureKeys: readonly string[],
  rosterMembers: readonly StandupRosterMember[],
): Promise<Map<string, CarryoverChildIssue[]>> {
  const uniqueKeys = [...new Set(featureKeys.map((key) => key.trim()).filter(Boolean))];
  const childrenByFeature = new Map<string, CarryoverChildIssue[]>();
  if (uniqueKeys.length === 0) {
    return childrenByFeature;
  }

  const featureLinkFieldId = loadConfiguredFeatureLinkFieldId();
  const featureLinkFieldNumber = featureLinkFieldId.replace('customfield_', '');
  const resolveAssigneeRole = buildAssigneeRoleResolver(rosterMembers);
  const fields = ['summary', 'status', 'assignee', featureLinkFieldId, ...STORY_POINTS_FIELD_IDS].join(',');

  for (const batch of batchFeatureKeys(uniqueKeys)) {
    const jql = `cf[${featureLinkFieldNumber}] in (${batch.map(quoteJqlValue).join(', ')})`;
    const searchResponse = await jiraGet<{ issues?: RawChildIssue[] }>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=200`,
    );

    for (const rawChild of searchResponse.issues ?? []) {
      const featureKey = extractFeatureKeyFromIssueFields(rawChild.fields ?? {}, featureLinkFieldId);
      if (featureKey === null) continue;

      const child: CarryoverChildIssue = {
        summary: rawChild.fields?.summary ?? '',
        status: rawChild.fields?.status?.name ?? '',
        statusCategoryKey: rawChild.fields?.status?.statusCategory?.key ?? null,
        storyPoints: readChildStoryPoints(rawChild.fields),
        assigneeRoleKind: resolveAssigneeRole(rawChild.fields?.assignee ?? null),
      };

      const existing = childrenByFeature.get(featureKey) ?? [];
      existing.push(child);
      childrenByFeature.set(featureKey, existing);
    }
  }

  return childrenByFeature;
}
