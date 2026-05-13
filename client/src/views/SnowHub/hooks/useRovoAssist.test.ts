// useRovoAssist.test.ts — Unit tests for the Rovo AI prompt generator hook.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import { useRovoAssist } from './useRovoAssist.ts';

function createMockJiraIssue(issueKey: string, summary: string): JiraIssue {
  return {
    id:     issueKey,
    key:    issueKey,
    fields: {
      summary,
      status:    { name: 'Done', statusCategory: { key: 'done' } },
      priority:  { name: 'High', iconUrl: '' },
      assignee:  null,
      reporter:  null,
      issuetype: { name: 'Story', iconUrl: '' },
      created:   '2025-01-01T00:00:00.000Z',
      updated:   '2025-01-01T00:00:00.000Z',
      description: null,
    },
  };
}

const EMPTY_CURRENT_FIELDS = {
  shortDescription: '',
  description:      '',
  justification:    '',
  riskImpact:       '',
};

describe('useRovoAssist', () => {
  it('starts in a locked state', () => {
    const { result } = renderHook(() => useRovoAssist());

    expect(result.current.isUnlocked).toBe(false);
  });

  it('unlocks and returns true when the correct passphrase is provided', async () => {
    const { result } = renderHook(() => useRovoAssist());

    let isValid = false;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('rovonow');
    });

    expect(isValid).toBe(true);
    expect(result.current.isUnlocked).toBe(true);
  });

  it('stays locked and returns false when an incorrect passphrase is provided', async () => {
    const { result } = renderHook(() => useRovoAssist());

    let isValid = true;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('wrongpassword');
    });

    expect(isValid).toBe(false);
    expect(result.current.isUnlocked).toBe(false);
  });

  it('stays locked when an empty string is provided as a passphrase', async () => {
    const { result } = renderHook(() => useRovoAssist());

    let isValid = true;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('');
    });

    expect(isValid).toBe(false);
    expect(result.current.isUnlocked).toBe(false);
  });

  it('buildPrompt returns a non-empty string containing the expected AI instruction', () => {
    const { result } = renderHook(() => useRovoAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-1', 'Fix critical bug')];

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('ServiceNow Change Request');
    expect(prompt).toContain('SHORT_DESCRIPTION:');
    expect(prompt).toContain('DESCRIPTION:');
    expect(prompt).toContain('JUSTIFICATION:');
    expect(prompt).toContain('RISK_AND_IMPACT:');
  });

  it('buildPrompt includes the issue key and summary in the output', () => {
    const { result } = renderHook(() => useRovoAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-42', 'Fix the release blocker')];

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('TOOL-42');
    expect(prompt).toContain('Fix the release blocker');
  });

  it('buildPrompt includes "(no issues selected)" when the issue list is empty', () => {
    const { result } = renderHook(() => useRovoAssist());

    const prompt = result.current.buildPrompt([], EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('(no issues selected)');
  });

  it('buildPrompt includes existing field values when they are non-empty', () => {
    const { result } = renderHook(() => useRovoAssist());
    const existingFields = {
      shortDescription: 'Deploy TOOL 2.0.0',
      description:      'Deploys the new version',
      justification:    'Planned release',
      riskImpact:       'Low risk',
    };

    const prompt = result.current.buildPrompt([], existingFields);

    expect(prompt).toContain('Deploy TOOL 2.0.0');
    expect(prompt).toContain('Deploys the new version');
    expect(prompt).toContain('Planned release');
    expect(prompt).toContain('Low risk');
  });

  it('buildPrompt omits the "Existing content" section when all fields are empty', () => {
    const { result } = renderHook(() => useRovoAssist());

    const prompt = result.current.buildPrompt([], EMPTY_CURRENT_FIELDS);

    expect(prompt).not.toContain('Existing content to refine');
  });
});
