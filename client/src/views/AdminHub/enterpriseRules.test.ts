// enterpriseRules.test.ts — Tests for shared enterprise hygiene rule storage and migration.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ENTERPRISE_RULES,
  loadEnterpriseRulesFromStorage,
  readEnabledBuiltInCheckIds,
} from './enterpriseRules.ts';

describe('enterpriseRules', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns default rules when no storage exists', () => {
    expect(loadEnterpriseRulesFromStorage()).toEqual(DEFAULT_ENTERPRISE_RULES);
  });

  it('migrates legacy built-in ids and backfills newly added built-in rules', () => {
    window.localStorage.setItem('tbxEnterpriseStandards', JSON.stringify([
      {
        id: 'rule-missing-assignee',
        name: 'Missing Assignee',
        description: 'Legacy rule',
        isBuiltIn: true,
        isEnabled: true,
      },
      {
        id: 'rule-stale-ticket',
        name: 'Stale Ticket',
        description: 'Legacy rule',
        isBuiltIn: true,
        isEnabled: false,
      },
    ]));

    const loadedRules = loadEnterpriseRulesFromStorage();
    const enabledCheckIds = readEnabledBuiltInCheckIds(loadedRules);

    expect(loadedRules.some((enterpriseRule) => enterpriseRule.id === 'no-assignee')).toBe(true);
    expect(loadedRules.some((enterpriseRule) => enterpriseRule.id === 'due-date-overdue')).toBe(true);
    expect(enabledCheckIds.has('no-assignee')).toBe(true);
    expect(enabledCheckIds.has('stale')).toBe(false);
  });
});
