// enterpriseRules.ts — Shared enterprise hygiene rule definitions and storage helpers.
//
// Keeps the Admin Hub rule editor, Hygiene view, and Feature Review aligned on the
// same persisted rule model so toggles and custom validations enforce real behavior.

import type { HygieneSeverity, HygieneCheckId } from '../Hygiene/checks/hygieneChecks.ts';

export const ENTERPRISE_STANDARDS_STORAGE_KEY = 'tbxEnterpriseStandards';
export const CUSTOM_RULE_TYPE_REQUIRED_FIELD = 'required-field';

export type EnterpriseRuleType = 'built-in' | typeof CUSTOM_RULE_TYPE_REQUIRED_FIELD;

export interface EnterpriseRuleBase {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  severity: HygieneSeverity;
}

export interface EnterpriseBuiltInRule extends EnterpriseRuleBase {
  ruleType: 'built-in';
  checkId: HygieneCheckId;
}

export interface EnterpriseRequiredFieldRule extends EnterpriseRuleBase {
  ruleType: typeof CUSTOM_RULE_TYPE_REQUIRED_FIELD;
  fieldId: string;
  fieldLabel: string;
  issueTypeNames: string[];
}

export type EnterpriseRule = EnterpriseBuiltInRule | EnterpriseRequiredFieldRule;

export interface EnterpriseCheckDefinition {
  checkId: string;
  label: string;
}

const DEFAULT_CUSTOM_RULE_SEVERITY: HygieneSeverity = 'warn';

const BUILT_IN_RULE_DEFINITIONS: readonly Omit<EnterpriseBuiltInRule, 'isBuiltIn' | 'isEnabled' | 'severity' | 'ruleType'>[] = [
  {
    id: 'missing-summary',
    checkId: 'missing-summary',
    name: 'Missing Feature Name / Summary',
    description: 'Every feature issue must keep the Jira summary populated because that is the feature name shown to teams.',
  },
  {
    id: 'missing-feature-link',
    checkId: 'missing-feature-link',
    name: 'Missing Feature Link',
    description: 'Stories, tasks, bugs, defects, and spikes must be linked to a feature.',
  },
  {
    id: 'missing-parent-link',
    checkId: 'missing-parent-link',
    name: 'Missing Parent Link',
    description: 'Feature issues must include their required parent link.',
  },
  {
    id: 'missing-product-owner',
    checkId: 'missing-product-owner',
    name: 'Missing Product Owner',
    description: 'Feature issues must include a Product Owner value.',
  },
  {
    id: 'missing-initiative-type',
    checkId: 'missing-initiative-type',
    name: 'Missing Initiative Type',
    description: 'Feature issues must include an Initiative Type value.',
  },
  {
    id: 'no-assignee',
    checkId: 'no-assignee',
    name: 'Missing Assignee',
    description: 'Every active issue should have an accountable assignee.',
  },
  {
    id: 'no-ac',
    checkId: 'no-ac',
    name: 'Missing Acceptance Criteria',
    description: 'Stories and feature issues must include meaningful acceptance criteria.',
  },
  {
    id: 'missing-child-story-points',
    checkId: 'missing-child-story-points',
    name: 'Missing Pointed Child Story',
    description: 'Feature issues must have at least one child story with positive story points.',
  },
  {
    id: 'missing-pi',
    checkId: 'missing-pi',
    name: 'Missing PI',
    description: 'Feature issues must align to the Program Increment where the work will finish.',
  },
  {
    id: 'missing-target-start',
    checkId: 'missing-target-start',
    name: 'Missing Target Start',
    description: 'Feature issues must include the target start date expected for implementation.',
  },
  {
    id: 'missing-target-end',
    checkId: 'missing-target-end',
    name: 'Missing Target End',
    description: 'Feature issues must include the target completion date.',
  },
  {
    id: 'missing-application',
    checkId: 'missing-application',
    name: 'Missing Application',
    description: 'Feature issues must identify the application or CMDB record they affect.',
  },
  {
    id: 'missing-fix-version',
    checkId: 'missing-fix-version',
    name: 'Missing Fix Version',
    description: 'Feature issues must include the production fix version when they are deployable.',
  },
  {
    id: 'missing-due-date',
    checkId: 'missing-due-date',
    name: 'Missing Due Date',
    description: 'Feature issues must include the committed release due date.',
  },
  {
    id: 'target-start-ready',
    checkId: 'target-start-ready',
    name: 'Target Start reached while still To Do',
    description: 'If a feature is still in the To Do status category when Target Start is today or earlier, the team must either move it to Implementing or update Target Start.',
  },
  {
    id: 'target-end-overdue',
    checkId: 'target-end-overdue',
    name: 'Target End reached before testing transition',
    description: 'If a feature is still To Do or Implementing when Target End is today or earlier, the team must either move it to Integrated Test or update Target End.',
  },
  {
    id: 'due-date-overdue',
    checkId: 'due-date-overdue',
    name: 'Due Date reached before completion',
    description: 'If a feature is not Done when Due Date is today or earlier, the team must either finish it or update Due Date.',
  },
  {
    id: 'missing-sp',
    checkId: 'missing-sp',
    name: 'Unpointed Story',
    description: 'Stories in active sprints must have story points set.',
  },
  {
    id: 'stale',
    checkId: 'stale',
    name: 'Stale Ticket',
    description:
      "Tickets in-progress with no updates past the team's stale threshold (default 5 days) should be reviewed.",
  },
  {
    id: 'old-in-sprint',
    checkId: 'old-in-sprint',
    name: 'Old in Sprint',
    description: 'Issues that sit in an active sprint for 30+ days should be reviewed.',
  },
] as const;

const LEGACY_RULE_ID_TO_CHECK_ID: Readonly<Record<string, HygieneCheckId>> = {
  'rule-missing-feature-summary': 'missing-summary',
  'rule-missing-feature-link': 'missing-feature-link',
  'rule-missing-parent-link': 'missing-parent-link',
  'rule-missing-product-owner': 'missing-product-owner',
  'rule-missing-initiative-type': 'missing-initiative-type',
  'rule-missing-assignee': 'no-assignee',
  'rule-missing-acceptance-criteria': 'no-ac',
  'rule-missing-pointed-child-story': 'missing-child-story-points',
  'rule-missing-pi': 'missing-pi',
  'rule-missing-target-start': 'missing-target-start',
  'rule-missing-target-end': 'missing-target-end',
  'rule-missing-application': 'missing-application',
  'rule-missing-fix-version': 'missing-fix-version',
  'rule-missing-due-date': 'missing-due-date',
  'rule-unpointed-story': 'missing-sp',
  'rule-stale-ticket': 'stale',
  'rule-old-in-sprint': 'old-in-sprint',
};

const DEFAULT_ENTERPRISE_RULE_LOOKUP = BUILT_IN_RULE_DEFINITIONS.reduce<Record<string, EnterpriseBuiltInRule>>(
  (ruleLookup, builtInRuleDefinition) => ({
    ...ruleLookup,
    [builtInRuleDefinition.id]: {
      ...builtInRuleDefinition,
      isBuiltIn: true,
      isEnabled: true,
      severity: builtInRuleDefinition.checkId === 'missing-summary' || builtInRuleDefinition.checkId === 'no-assignee' ? 'error' : 'warn',
      ruleType: 'built-in',
    },
  }),
  {},
);

export const DEFAULT_ENTERPRISE_RULES: EnterpriseRule[] = Object.values(DEFAULT_ENTERPRISE_RULE_LOOKUP);

/**
 * Loads the persisted enterprise rules, migrating older built-in IDs into the
 * shared rule model when needed.
 */
export function loadEnterpriseRulesFromStorage(): EnterpriseRule[] {
  try {
    const rawValue = localStorage.getItem(ENTERPRISE_STANDARDS_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_ENTERPRISE_RULES;
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsedValue) || parsedValue.length === 0) {
      return DEFAULT_ENTERPRISE_RULES;
    }

    const normalizedRules = parsedValue
      .map((parsedRule) => normalizeEnterpriseRule(parsedRule))
      .filter((enterpriseRule): enterpriseRule is EnterpriseRule => enterpriseRule !== null);

    return normalizedRules.length > 0 ? mergeMissingBuiltInRules(normalizedRules) : DEFAULT_ENTERPRISE_RULES;
  } catch {
    return DEFAULT_ENTERPRISE_RULES;
  }
}

/** Saves the full enterprise rule list to localStorage. */
export function saveEnterpriseRulesToStorage(enterpriseRules: EnterpriseRule[]): void {
  try {
    localStorage.setItem(ENTERPRISE_STANDARDS_STORAGE_KEY, JSON.stringify(enterpriseRules));
  } catch {
    // Non-fatal: the in-memory rule list stays authoritative until refresh.
  }
}

/** Returns the enabled built-in Hygiene check IDs. */
export function readEnabledBuiltInCheckIds(
  enterpriseRules: EnterpriseRule[] = loadEnterpriseRulesFromStorage(),
): Set<HygieneCheckId> {
  return new Set(
    enterpriseRules
      .filter((enterpriseRule): enterpriseRule is EnterpriseBuiltInRule => enterpriseRule.ruleType === 'built-in' && enterpriseRule.isEnabled)
      .map((enterpriseRule) => enterpriseRule.checkId),
  );
}

/** Returns the enabled custom required-field rules. */
export function readEnabledRequiredFieldRules(
  enterpriseRules: EnterpriseRule[] = loadEnterpriseRulesFromStorage(),
): EnterpriseRequiredFieldRule[] {
  return enterpriseRules.filter(
    (enterpriseRule): enterpriseRule is EnterpriseRequiredFieldRule =>
      enterpriseRule.ruleType === CUSTOM_RULE_TYPE_REQUIRED_FIELD
      && enterpriseRule.isEnabled
      && enterpriseRule.fieldId.trim() !== '',
  );
}

/** Returns the enabled check definitions used by Hygiene summary tiles. */
export function readEnabledEnterpriseCheckDefinitions(
  enterpriseRules: EnterpriseRule[] = loadEnterpriseRulesFromStorage(),
): EnterpriseCheckDefinition[] {
  return enterpriseRules
    .filter((enterpriseRule) => enterpriseRule.isEnabled)
    .map((enterpriseRule) => ({
      checkId: enterpriseRule.ruleType === 'built-in' ? enterpriseRule.checkId : enterpriseRule.id,
      label: enterpriseRule.name,
    }));
}

function mergeMissingBuiltInRules(enterpriseRules: EnterpriseRule[]): EnterpriseRule[] {
  const existingRuleIds = new Set(enterpriseRules.map((enterpriseRule) => enterpriseRule.id));
  const missingBuiltInRules = DEFAULT_ENTERPRISE_RULES.filter((defaultRule) => !existingRuleIds.has(defaultRule.id));
  return [...enterpriseRules, ...missingBuiltInRules];
}

function normalizeEnterpriseRule(parsedRule: unknown): EnterpriseRule | null {
  if (!parsedRule || typeof parsedRule !== 'object') {
    return null;
  }

  const parsedRuleRecord = parsedRule as Record<string, unknown>;
  const normalizedRuleId = readNormalizedRuleId(parsedRuleRecord.id);
  const defaultBuiltInRule = normalizedRuleId ? DEFAULT_ENTERPRISE_RULE_LOOKUP[normalizedRuleId] : undefined;
  if (defaultBuiltInRule) {
    return {
      ...defaultBuiltInRule,
      isEnabled: readBooleanValue(parsedRuleRecord.isEnabled, defaultBuiltInRule.isEnabled),
      description: readStringValue(parsedRuleRecord.description, defaultBuiltInRule.description),
      name: readStringValue(parsedRuleRecord.name, defaultBuiltInRule.name),
      severity: readSeverityValue(parsedRuleRecord.severity, defaultBuiltInRule.severity),
    };
  }

  const customRuleId = readStringValue(parsedRuleRecord.id, '').trim();
  if (!customRuleId) {
    return null;
  }

  return {
    id: customRuleId,
    name: readStringValue(parsedRuleRecord.name, 'Custom Rule'),
    description: readStringValue(parsedRuleRecord.description, ''),
    isBuiltIn: false,
    isEnabled: readBooleanValue(parsedRuleRecord.isEnabled, true),
    severity: readSeverityValue(parsedRuleRecord.severity, DEFAULT_CUSTOM_RULE_SEVERITY),
    ruleType: CUSTOM_RULE_TYPE_REQUIRED_FIELD,
    fieldId: readStringValue(parsedRuleRecord.fieldId, ''),
    fieldLabel: readStringValue(parsedRuleRecord.fieldLabel, ''),
    issueTypeNames: readIssueTypeNames(parsedRuleRecord.issueTypeNames),
  };
}

function readNormalizedRuleId(rawRuleId: unknown): string {
  if (typeof rawRuleId !== 'string') {
    return '';
  }

  return LEGACY_RULE_ID_TO_CHECK_ID[rawRuleId] ?? rawRuleId;
}

function readStringValue(rawValue: unknown, fallbackValue: string): string {
  return typeof rawValue === 'string' ? rawValue : fallbackValue;
}

function readBooleanValue(rawValue: unknown, fallbackValue: boolean): boolean {
  return typeof rawValue === 'boolean' ? rawValue : fallbackValue;
}

function readSeverityValue(rawValue: unknown, fallbackValue: HygieneSeverity): HygieneSeverity {
  return rawValue === 'error' || rawValue === 'warn' ? rawValue : fallbackValue;
}

function readIssueTypeNames(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .filter((issueTypeName): issueTypeName is string => typeof issueTypeName === 'string')
    .map((issueTypeName) => issueTypeName.trim())
    .filter(Boolean);
}
