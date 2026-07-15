// usePoHygieneContext.test.ts — Proves the PO Tool applies the SAME hygiene rules as the Hygiene tool,
// including the one behaviour that matters most: a check whose field this Jira lacks stays quiet (FR-028).

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import type { JiraIssue as HygieneIssue } from '../../Hygiene/checks/hygieneChecks';
import { usePoHygieneContext } from './usePoHygieneContext';

/** A Jira instance that defines a Product Owner field. */
const FIELDS_WITH_PRODUCT_OWNER = [
  { id: 'customfield_20002', name: 'Product Owner' },
  { id: 'customfield_10301', name: 'Program Increment' },
];

/** A Jira instance that does not track Product Owner at all. */
const FIELDS_WITHOUT_PRODUCT_OWNER = [{ id: 'customfield_10301', name: 'Program Increment' }];

function buildFeature(fields: Record<string, unknown> = {}): HygieneIssue {
  return {
    key: 'ABC-1',
    self: 'https://jira/rest/api/2/issue/1',
    fields: {
      summary: 'Claims platform',
      issuetype: { name: 'Feature' },
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      assignee: { displayName: 'Someone' },
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-15T00:00:00.000Z',
      ...fields,
    },
  } as HygieneIssue;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockJiraGet.mockResolvedValue(FIELDS_WITH_PRODUCT_OWNER);
});

describe('usePoHygieneContext — field config', () => {
  it('reads the live instance field list', async () => {
    renderHook(() => usePoHygieneContext('profile-alpha'));

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/field'));
  });

  it('reports when it is done loading', async () => {
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));

    expect(result.current.isLoadingFieldConfig).toBe(true);
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));
  });

  it('resolves the instance\'s own field for a concept it defines', async () => {
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));

    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));
    expect(result.current.fieldConfig.productOwnerFieldIds).toContain('customfield_20002');
  });

  it('says so when the field list cannot be read, rather than pretending the verdict is complete', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unreachable'));

    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));

    await waitFor(() => expect(result.current.fieldConfigError).toBeTruthy());
    expect(result.current.fieldConfigError).toContain('Jira unreachable');
  });

  it('still evaluates against defaults when the field list cannot be read', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unreachable'));

    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));

    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));
    expect(() => result.current.evaluateDraft(buildFeature())).not.toThrow();
  });
});

describe('usePoHygieneContext — evaluateDraft uses the shared engine', () => {
  it('flags a Feature that is missing something the rules require', async () => {
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    const flags = result.current.evaluateDraft(buildFeature({ summary: '' }));

    expect(flags.map((flag) => flag.checkId)).toContain('missing-summary');
  });

  it('returns no flags for a draft that satisfies the rules', async () => {
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    const flags = result.current.evaluateDraft(buildFeature({ summary: 'A real summary' }));

    expect(flags.map((flag) => flag.checkId)).not.toContain('missing-summary');
  });

  it('carries the engine\'s own label and severity, so the PO reads what Hygiene would say', async () => {
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    const summaryFlag = result.current
      .evaluateDraft(buildFeature({ summary: '' }))
      .find((flag) => flag.checkId === 'missing-summary');

    expect(summaryFlag?.label).toBeTruthy();
    expect(['warn', 'error']).toContain(summaryFlag?.severity);
  });
});

describe('usePoHygieneContext — FR-028: an unconfigured field never false-flags', () => {
  it('flags a missing Product Owner when this Jira HAS a Product Owner field', async () => {
    mockJiraGet.mockResolvedValue(FIELDS_WITH_PRODUCT_OWNER);
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    const flags = result.current.evaluateDraft(buildFeature());

    expect(flags.map((flag) => flag.checkId)).toContain('missing-product-owner');
  });

  it('stays SILENT about Product Owner when this Jira has no such field', async () => {
    // The whole point of FR-028: a team that does not track Product Owner must not see every Feature
    // flagged for a field their Jira does not even have.
    mockJiraGet.mockResolvedValue(FIELDS_WITHOUT_PRODUCT_OWNER);
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    const flags = result.current.evaluateDraft(buildFeature());

    expect(flags.map((flag) => flag.checkId)).not.toContain('missing-product-owner');
  });
});

describe('usePoHygieneContext — respects the admin\'s configuration', () => {
  it('honours a disabled built-in rule', async () => {
    window.localStorage.setItem(
      'tbxEnterpriseStandards',
      JSON.stringify([{ id: 'missing-summary', ruleType: 'built-in', checkId: 'missing-summary', isEnabled: false }]),
    );

    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    const flags = result.current.evaluateDraft(buildFeature({ summary: '' }));

    expect(flags.map((flag) => flag.checkId)).not.toContain('missing-summary');
  });

  it('re-reads the rules per evaluation, so an admin\'s change is not ignored until reload', async () => {
    const { result } = renderHook(() => usePoHygieneContext('profile-alpha'));
    await waitFor(() => expect(result.current.isLoadingFieldConfig).toBe(false));

    expect(result.current.evaluateDraft(buildFeature({ summary: '' })).map((flag) => flag.checkId))
      .toContain('missing-summary');

    window.localStorage.setItem(
      'tbxEnterpriseStandards',
      JSON.stringify([{ id: 'missing-summary', ruleType: 'built-in', checkId: 'missing-summary', isEnabled: false }]),
    );

    expect(result.current.evaluateDraft(buildFeature({ summary: '' })).map((flag) => flag.checkId))
      .not.toContain('missing-summary');
  });
});
