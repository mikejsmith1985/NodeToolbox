// piPlanFields.ts — Resolves the Jira custom-field ids the planner writes to, REUSING the existing
// name→id discovery (loadHygieneFieldConfig). Returns the single best id per concept with the known
// platform defaults as fallbacks; Due date is Jira-native. No new discovery mechanism is built.

import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';

const DEFAULT_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_TARGET_END_FIELD_ID = 'customfield_10102';
const DEFAULT_FEATURE_LINK_FIELD_ID = 'customfield_10108';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';

/** The field ids the plan-write flow needs. Due date is the native `duedate` field, not a custom field. */
export interface PiPlanFieldIds {
  targetStart: string;
  targetEnd: string;
  due: 'duedate';
  featureLink: string;
  programIncrement: string;
}

/** Returns the first id in a discovered list, or the platform default when the instance has none. */
function firstOrDefault(fieldIds: string[] | undefined, fallback: string): string {
  return fieldIds && fieldIds.length > 0 ? fieldIds[0] : fallback;
}

/** Resolves the planner's field ids from the connected instance (admin overrides already applied upstream). */
export async function resolvePiPlanFieldIds(): Promise<PiPlanFieldIds> {
  const config = await loadHygieneFieldConfig();
  return {
    targetStart: firstOrDefault(config.targetStartFieldIds, DEFAULT_TARGET_START_FIELD_ID),
    targetEnd: firstOrDefault(config.targetEndFieldIds, DEFAULT_TARGET_END_FIELD_ID),
    due: 'duedate',
    featureLink: firstOrDefault(config.featureLinkFieldIds, DEFAULT_FEATURE_LINK_FIELD_ID),
    programIncrement: firstOrDefault(config.programIncrementFieldIds, DEFAULT_PI_FIELD_ID),
  };
}
