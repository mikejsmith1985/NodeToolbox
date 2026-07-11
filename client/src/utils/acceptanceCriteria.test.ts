// acceptanceCriteria.test.ts — Verifies AC field resolution (by name) and reading AC text off an issue.

import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import type { JiraIssue } from '../types/jira.ts';
import {
  DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID,
  matchAcceptanceCriteriaFieldIds,
  readAcceptanceCriteriaText,
  resolveAcceptanceCriteriaFieldIds,
} from './acceptanceCriteria.ts';

/** Minimal issue whose fields carry only what a test sets, cast to the full type for the reader. */
function issueWithFields(fields: Record<string, unknown>): JiraIssue {
  return { id: '1', key: 'ENCUC-1', fields } as unknown as JiraIssue;
}

describe('matchAcceptanceCriteriaFieldIds', () => {
  it('matches the field named "Acceptance Criteria" case-insensitively', () => {
    const fields = [
      { id: 'customfield_1', name: 'Acceptance Criteria' },
      { id: 'customfield_2', name: 'acceptance CRITERIA' },
      { id: 'customfield_3', name: 'Story Points' },
    ];
    expect(matchAcceptanceCriteriaFieldIds(fields)).toEqual(['customfield_1', 'customfield_2']);
  });
});

describe('resolveAcceptanceCriteriaFieldIds', () => {
  afterEach(() => mockJiraGet.mockReset());

  it('returns the named field(s) plus the default, de-duplicated', async () => {
    mockJiraGet.mockResolvedValue([{ id: 'customfield_10500', name: 'Acceptance Criteria' }]);
    await expect(resolveAcceptanceCriteriaFieldIds()).resolves.toEqual(['customfield_10500', DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID]);
  });

  it('falls back to just the default when the field lookup fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unavailable'));
    await expect(resolveAcceptanceCriteriaFieldIds()).resolves.toEqual([DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID]);
  });
});

describe('readAcceptanceCriteriaText', () => {
  it('returns the first configured field that has real content, normalised to plain text', () => {
    const issue = issueWithFields({ customfield_10500: '', customfield_10200: '<p>Given a user &amp; a click</p>' });
    expect(readAcceptanceCriteriaText(issue, ['customfield_10500', 'customfield_10200'])).toBe('Given a user & a click');
  });

  it('returns null when no configured AC field has content', () => {
    const issue = issueWithFields({ customfield_10200: '   ', description: 'not AC' });
    expect(readAcceptanceCriteriaText(issue, ['customfield_10200'])).toBeNull();
  });
});
