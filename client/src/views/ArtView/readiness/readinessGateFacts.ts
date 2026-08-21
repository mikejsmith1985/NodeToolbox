// readinessGateFacts.ts — Turning a scanned Feature into the facts the enterprise gate asks for.
//
// The gate module is field-blind on purpose: it holds the organisation's rules and knows nothing
// about Jira. This is the join between the two, and the only interesting thing about it is honesty.
//
// Readiness reads FEATURES, not their children, and this Jira has no field for Initiative Type or
// the CMDB Application. Those facts therefore come back as `null` — "not looked at" — rather
// than `false` or zero. Getting that wrong would be worse than useless: it would send a Product Owner to
// fill in a field that is very likely already filled in, and after the second time it would teach
// them to ignore the panel entirely.

import type { FeatureGateFacts } from '../../../domain/featureStateGates.ts';
import type { HygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';
import type { JiraIssue } from '../../../types/jira.ts';

/** The parts of a scanned Feature the gate needs that the scan has already resolved. */
export interface ResolvedReadinessValues {
  productOwnerDisplayName?: string | null;
  estimateValue?: string | null;
  targetEndIso?: string | null;
}

/** Whether a resolved value amounts to something. An empty string is a cleared field, not a value. */
function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Whether any of a field family's configured ids holds something.
 *
 * Every id is tried rather than just the first: a family lists the ids this instance MIGHT use, and
 * which one is actually in play differs by project.
 */
function hasAnyFieldValue(issue: JiraIssue, fieldIds: readonly string[]): boolean {
  const fields = issue.fields as unknown as Record<string, unknown>;
  return fieldIds.some((fieldId) => {
    const rawValue = fields[fieldId];
    if (rawValue === null || rawValue === undefined) {
      return false;
    }
    if (typeof rawValue === 'string') {
      return rawValue.trim() !== '';
    }
    // [] is truthy, so the length is what has to be checked — a bug this codebase has met before.
    if (Array.isArray(rawValue)) {
      return rawValue.length > 0;
    }
    if (typeof rawValue === 'object') {
      const asOption = rawValue as { value?: unknown; name?: unknown };
      return hasValue(String(asOption.value ?? asOption.name ?? '')) || Object.keys(rawValue).length > 0;
    }
    return true;
  });
}

/**
 * Builds the gate's facts from one scanned Feature.
 *
 * `isValueBearing` is assumed true. Nothing in Jira says whether a Feature is a spike, and assuming
 * it delivers value keeps the checkout and delivery criteria in play — which is the safe direction
 * to be wrong in, because it holds a Feature rather than releasing one.
 */
export function buildReadinessGateFacts(
  issue: JiraIssue,
  resolved: ResolvedReadinessValues,
  fieldConfig: HygieneFieldConfig,
  piFieldId: string,
): FeatureGateFacts {
  const fields = issue.fields as unknown as Record<string, unknown>;
  const fixVersions = Array.isArray(fields.fixVersions) ? fields.fixVersions : [];

  return {
    hasSummary: hasValue(String(fields.summary ?? '')),
    hasReporter: fields.reporter !== null && fields.reporter !== undefined,
    hasProductOwner: hasValue(resolved.productOwnerDisplayName),
    hasAssignee: fields.assignee !== null && fields.assignee !== undefined,
    hasParentLink: hasAnyFieldValue(issue, fieldConfig.featureLinkFieldIds ?? []),
    hasEstimate: hasValue(resolved.estimateValue),
    hasProgramIncrement: piFieldId === '' ? false : hasAnyFieldValue(issue, [piFieldId]),
    hasAcceptanceCriteria: hasAnyFieldValue(issue, fieldConfig.acceptanceCriteriaFieldIds ?? []),
    hasTargetStart: hasAnyFieldValue(issue, fieldConfig.targetStartFieldIds ?? []),
    hasTargetEnd: hasValue(resolved.targetEndIso),
    hasDueDate: hasValue(String(fields.duedate ?? '')),
    hasFixVersion: fixVersions.length > 0,

    // ── What this surface genuinely cannot answer ──
    // Jira has no field here for Initiative Type or the CMDB Application, and the scan reads
    // Features alone — so nothing about their children is known either. Saying "not looked at" is
    // the difference between a panel people act on and one they learn to skip.
    hasInitiativeType: null,
    hasApplication: null,
    areAllChildrenClosed: null,
    childStoriesWithPointsCount: null,

    // ── Facts no Jira field holds, for anybody ──
    // Whether code reached a region, whether checkout ran, whether a customer can use it: all
    // outside Jira entirely, and reported as such wherever this gate is evaluated.
    isCodeInUpperTestRegion: null,
    isCodeInProduction: null,
    haveTestExitCriteriaBeenMet: null,
    areCheckoutActivitiesComplete: null,
    isValueDeliveredToCustomer: null,

    isValueBearing: true,
  };
}
