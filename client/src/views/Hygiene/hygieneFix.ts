// hygieneFix.ts — Pure fix registry that turns each Hygiene flag into an actionable Jira control.
//
// The Hygiene view lists issue-health flags; this module maps every built-in flag to a concrete fix
// (an inline control kind + the Jira field it writes) and resolves the target field id from the
// caller's field config. The actual Jira writes are delegated to the proven, instance-correct
// helpers in `../SprintDashboard/featureReviewFixes.ts`, so this module stays pure and network-free
// and the fix formats exactly match what already works in Feature Review.

import type { BuiltInHygieneCheckId, HygieneFieldConfig } from './checks/hygieneChecks.ts';

/**
 * The kind of inline control a flag's fix uses.
 * - Field writes: `text`, `date`, `assignee`, `feature`, `parent`, `fixVersion`, `programIncrement`,
 *   `storyPoints`, `select` — each maps to a `saveFeatureReview*` helper.
 * - `transition` — a "Move status" dropdown for derived flags that are really a stuck workflow state.
 * - `openInJira` — the flag is derived elsewhere (or its field is unconfigured); link out instead.
 */
export type HygieneFixKind =
  | 'text'
  | 'date'
  | 'assignee'
  | 'feature'
  | 'parent'
  | 'fixVersion'
  | 'programIncrement'
  | 'storyPoints'
  | 'select'
  | 'transition'
  | 'openInJira';

/** Describes how one Hygiene flag is fixed: the control kind and where its value is written. */
export interface HygieneFixDescriptor {
  kind: HygieneFixKind;
  /** Which resolved field-config list holds the target field id (first configured id wins). */
  fieldConfigKey?: keyof HygieneFieldConfig;
  /** A fixed Jira system field id (e.g. 'summary', 'duedate', 'assignee') the fix always writes. */
  systemFieldId?: string;
  /** Human-readable label describing the fix action. */
  label: string;
}

/**
 * Registry mapping every built-in Hygiene check to its fix. Flags that represent a stuck workflow
 * state (a date passed while the issue sat in an early status) offer a status transition; flags whose
 * fix lives elsewhere (a child issue) or has no single field link out via `openInJira`.
 */
export const HYGIENE_FIX_BY_CHECK: Record<BuiltInHygieneCheckId, HygieneFixDescriptor> = {
  'missing-summary': { kind: 'text', systemFieldId: 'summary', label: 'Set summary' },
  'no-ac': { kind: 'text', fieldConfigKey: 'acceptanceCriteriaFieldIds', label: 'Set acceptance criteria' },
  'no-assignee': { kind: 'assignee', systemFieldId: 'assignee', label: 'Assign owner' },
  'missing-product-owner': { kind: 'assignee', fieldConfigKey: 'productOwnerFieldIds', label: 'Set product owner' },
  'missing-due-date': { kind: 'date', systemFieldId: 'duedate', label: 'Set due date' },
  'missing-target-start': { kind: 'date', fieldConfigKey: 'targetStartFieldIds', label: 'Set target start' },
  'missing-target-end': { kind: 'date', fieldConfigKey: 'targetEndFieldIds', label: 'Set target end' },
  'missing-feature-link': { kind: 'feature', fieldConfigKey: 'featureLinkFieldIds', label: 'Link feature' },
  'missing-parent-link': { kind: 'parent', fieldConfigKey: 'parentLinkFieldIds', label: 'Link parent' },
  'missing-fix-version': { kind: 'fixVersion', systemFieldId: 'fixVersions', label: 'Set fix version' },
  'missing-pi': { kind: 'programIncrement', fieldConfigKey: 'programIncrementFieldIds', label: 'Set program increment' },
  'missing-sp': { kind: 'storyPoints', label: 'Set story points' },
  'missing-initiative-type': { kind: 'select', fieldConfigKey: 'initiativeTypeFieldIds', label: 'Set initiative type' },
  'missing-application': { kind: 'select', fieldConfigKey: 'applicationFieldIds', label: 'Set application' },
  // Derived "stuck status" flags: the fix is to move the issue forward, offered as a transition.
  stale: { kind: 'transition', label: 'Move status' },
  'target-start-ready': { kind: 'transition', label: 'Move status' },
  'target-end-overdue': { kind: 'transition', label: 'Move status' },
  'due-date-overdue': { kind: 'transition', label: 'Move status' },
  // Fix lives elsewhere (a child issue) or is a review judgement call: link out to Jira.
  'old-in-sprint': { kind: 'openInJira', label: 'Review in Jira' },
  'missing-child-story-points': { kind: 'openInJira', label: 'Review in Jira' },
};

/**
 * Resolves the Jira field id a field-writing fix targets: an explicit system field id if declared,
 * else the first configured id in the descriptor's field-config list. Returns null when neither is
 * available — the UI must then fall back to an "Open in Jira" link with a "field not configured"
 * note. (Kinds that resolve their own target, like `storyPoints`, ignore this result.)
 */
export function resolveFixFieldId(descriptor: HygieneFixDescriptor, fieldConfig: HygieneFieldConfig): string | null {
  if (descriptor.systemFieldId) {
    return descriptor.systemFieldId;
  }
  if (descriptor.fieldConfigKey) {
    return (fieldConfig[descriptor.fieldConfigKey] ?? [])[0] ?? null;
  }
  return null;
}
