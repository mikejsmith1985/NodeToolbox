// hygieneFieldConfig.test.ts — Proves hygiene checks resolve to the fields THIS Jira instance actually has.
//
// This matters most for the skip behaviour: a field the instance does not define must resolve to an empty
// list, so the corresponding check quietly skips instead of flagging every issue for a field nobody uses.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import {
  loadHygieneFieldConfig,
  matchFieldIdsByName,
  readHygieneArtSettings,
} from './hygieneFieldConfig.ts';

/** The instance's field list, as Jira reports it from /rest/api/2/field. */
const INSTANCE_FIELDS = [
  { id: 'customfield_20001', name: 'Acceptance Criteria' },
  { id: 'customfield_20002', name: 'Product Owner' },
  { id: 'customfield_20003', name: 'Program Increment' },
  { id: 'customfield_20004', name: 'Target Start' },
  { id: 'customfield_20005', name: 'Target End' },
  { id: 'customfield_20006', name: 'Unrelated Field' },
];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockJiraGet.mockResolvedValue(INSTANCE_FIELDS);
});

describe('matchFieldIdsByName', () => {
  it('matches a field by its exact name', () => {
    expect(matchFieldIdsByName(INSTANCE_FIELDS, ['Product Owner'])).toEqual(['customfield_20002']);
  });

  it('ignores case and spacing differences between instances', () => {
    const oddlyNamedFields = [{ id: 'customfield_30001', name: '  product   OWNER ' }];

    expect(matchFieldIdsByName(oddlyNamedFields, ['Product Owner'])).toEqual(['customfield_30001']);
  });

  it('matches a field whose name merely contains the concept, as instances often decorate labels', () => {
    const decoratedFields = [{ id: 'customfield_30002', name: 'PI (Program Increment)' }];

    expect(matchFieldIdsByName(decoratedFields, ['Program Increment'])).toEqual(['customfield_30002']);
  });

  it('returns nothing when the instance has no such field', () => {
    expect(matchFieldIdsByName(INSTANCE_FIELDS, ['Nonexistent Field'])).toEqual([]);
  });

  it('finds every field matching any of the given names', () => {
    const ids = matchFieldIdsByName(INSTANCE_FIELDS, ['Target Start', 'Target End']);

    expect(ids).toEqual(['customfield_20004', 'customfield_20005']);
  });
});

describe('readHygieneArtSettings', () => {
  it('reads the workspace-configured field ids', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_99999' }));

    expect(readHygieneArtSettings().piFieldId).toBe('customfield_99999');
  });

  it('treats unreadable settings as nothing configured rather than throwing', () => {
    window.localStorage.setItem('tbxARTSettings', '{not json');

    expect(readHygieneArtSettings()).toEqual({});
  });

  it('treats absent settings as nothing configured', () => {
    expect(readHygieneArtSettings()).toEqual({});
  });
});

describe('loadHygieneFieldConfig', () => {
  it('asks the live instance for its fields', async () => {
    await loadHygieneFieldConfig();

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/field');
  });

  it('resolves a field the instance reports by name', async () => {
    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.productOwnerFieldIds).toContain('customfield_20002');
  });

  it('leaves a concept the instance has no field for unresolved, so its check skips', async () => {
    // The engine skips a check whose field list is empty — that is how an unused field avoids
    // false-flagging every issue (FR-028). This test is the guard on that behaviour.
    mockJiraGet.mockResolvedValue([{ id: 'customfield_20006', name: 'Unrelated Field' }]);

    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.productOwnerFieldIds).toEqual([]);
    expect(fieldConfig.applicationFieldIds).toEqual([]);
    expect(fieldConfig.initiativeTypeFieldIds).toEqual([]);
  });

  it('includes the workspace-configured id among the candidates', async () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_99999' }));

    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.programIncrementFieldIds).toContain('customfield_99999');
  });

  it('puts the workspace-configured id first, so a direct fix writes where the team keeps it', async () => {
    // This originally pinned the opposite: the built-in default outranked a configured field, so an
    // admin who configured a PI field still got customfield_10301 for direct fixes. That was left alone
    // here because lifting this loader had to preserve behaviour, and fixed separately in #153.
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_99999' }));

    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.programIncrementFieldIds[0]).toBe('customfield_99999');
  });

  it('still includes the name-matched field alongside the configured one', async () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_99999' }));

    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.programIncrementFieldIds).toContain('customfield_20003');
  });

  it('always considers the native parent relationship for parent links', async () => {
    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.parentLinkFieldIds).toContain('parent');
  });

  it('falls back to the documented default when nothing is configured and nothing matches by name', async () => {
    mockJiraGet.mockResolvedValue([]);

    const fieldConfig = await loadHygieneFieldConfig();

    expect(fieldConfig.programIncrementFieldIds).toContain('customfield_10301');
  });
});
