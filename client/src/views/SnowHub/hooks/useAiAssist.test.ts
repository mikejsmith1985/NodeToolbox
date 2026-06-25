// useAiAssist.test.ts — Unit tests for the hidden AI Assist prompt generator hook.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { parseAiAssistChgResponse, useAiAssist } from './useAiAssist.ts';

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

function createAtlassianDocumentNode(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  };
}

const EMPTY_CURRENT_FIELDS = {
  shortDescription: '',
  description:      '',
  justification:    '',
  riskImpact:       '',
};

describe('useAiAssist', () => {
  beforeEach(() => {
    // Reset the shared unlock store between tests (it is a global singleton).
    sessionStorage.clear();
    setAiAssistUnlocked(false);
  });

  it('starts in a locked state', () => {
    const { result } = renderHook(() => useAiAssist());

    expect(result.current.isUnlocked).toBe(false);
  });

  it('unlocks and returns true when the correct passphrase is provided', async () => {
    const { result } = renderHook(() => useAiAssist());

    let isValid = false;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('ainow');
    });

    expect(isValid).toBe(true);
    expect(result.current.isUnlocked).toBe(true);
  });

  it('stays locked and returns false when an incorrect passphrase is provided', async () => {
    const { result } = renderHook(() => useAiAssist());

    let isValid = true;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('wrongpassword');
    });

    expect(isValid).toBe(false);
    expect(result.current.isUnlocked).toBe(false);
  });

  it('stays locked when an empty string is provided as a passphrase', async () => {
    const { result } = renderHook(() => useAiAssist());

    let isValid = true;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('');
    });

    expect(isValid).toBe(false);
    expect(result.current.isUnlocked).toBe(false);
  });

  it('buildPrompt returns a non-empty string containing the expected prompt instruction', () => {
    const { result } = renderHook(() => useAiAssist());
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
    const { result } = renderHook(() => useAiAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-42', 'Fix the release blocker')];

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('TOOL-42');
    expect(prompt).toContain('Fix the release blocker');
  });

  it('buildPrompt includes Jira description and acceptance criteria details for each issue', () => {
    const { result } = renderHook(() => useAiAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-77', 'Align release validation')];
    selectedIssues[0].fields.description = 'Implements the release validation updates.';
    selectedIssues[0].fields.customfield_10200 = 'Given release input is valid, when deployed, then validation passes.';

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('Jira issue details for better CHG drafting:');
    expect(prompt).toContain('Description: Implements the release validation updates.');
    expect(prompt).toContain('Acceptance Criteria: Given release input is valid, when deployed, then validation passes.');
  });

  it('buildPrompt strips encoded HTML tags from issue detail text', () => {
    const { result } = renderHook(() => useAiAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-78', 'Clean encoded detail markup')];
    selectedIssues[0].fields.description = '<p dir="auto" style="animation-duration:0.01ms;">Facets:</p>';
    selectedIssues[0].fields.customfield_10200 = '<b>Given valid input</b> &amp; expected output';

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('Description: Facets:');
    expect(prompt).toContain('Acceptance Criteria: Given valid input & expected output');
    expect(prompt).not.toContain('style=');
    expect(prompt).not.toContain('<p');
    expect(prompt).not.toContain('<b>');
  });

  it('buildPrompt extracts Atlassian document-format text for issue details', () => {
    const { result } = renderHook(() => useAiAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-88', 'Handle Atlassian document text')];
    selectedIssues[0].fields.description = createAtlassianDocumentNode('Document description') as unknown as string;
    selectedIssues[0].fields.customfield_10200 = createAtlassianDocumentNode('Document acceptance criteria');

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('Description: Document description');
    expect(prompt).toContain('Acceptance Criteria: Document acceptance criteria');
  });

  it('buildPrompt shows explicit placeholders when issue detail fields are missing', () => {
    const { result } = renderHook(() => useAiAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-99', 'No detail fields')];

    const prompt = result.current.buildPrompt(selectedIssues, EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('Description: (not provided)');
    expect(prompt).toContain('Acceptance Criteria: (not provided)');
  });

  it('buildPrompt includes "(no issues selected)" when the issue list is empty', () => {
    const { result } = renderHook(() => useAiAssist());

    const prompt = result.current.buildPrompt([], EMPTY_CURRENT_FIELDS);

    expect(prompt).toContain('(no issues selected)');
  });

  it('buildPrompt includes existing field values when they are non-empty', () => {
    const { result } = renderHook(() => useAiAssist());
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
    const { result } = renderHook(() => useAiAssist());

    const prompt = result.current.buildPrompt([], EMPTY_CURRENT_FIELDS);

    expect(prompt).not.toContain('Existing content to refine');
  });
});

describe('parseAiAssistChgResponse', () => {
  it('parses all four fields from the deterministic block', () => {
    const response = [
      'SHORT_DESCRIPTION: Deploy TOOL 2.0',
      'DESCRIPTION: Rolls out the new release',
      'JUSTIFICATION: Planned PI work',
      'RISK_AND_IMPACT: Low risk, no downtime',
    ].join('\n');

    expect(parseAiAssistChgResponse(response)).toEqual({
      shortDescription: 'Deploy TOOL 2.0',
      description: 'Rolls out the new release',
      justification: 'Planned PI work',
      riskImpact: 'Low risk, no downtime',
    });
  });

  it('preserves multi-line values up to the next marker', () => {
    const response = [
      'SHORT_DESCRIPTION: One line',
      'DESCRIPTION: First line of detail',
      'second line of detail',
      'JUSTIFICATION: Because',
      'RISK_AND_IMPACT: None',
    ].join('\n');

    expect(parseAiAssistChgResponse(response).description).toBe('First line of detail\nsecond line of detail');
  });

  it('does not confuse the DESCRIPTION marker with SHORT_DESCRIPTION', () => {
    const response = 'SHORT_DESCRIPTION: Short text\nDESCRIPTION: Long text';
    const parsed = parseAiAssistChgResponse(response);
    expect(parsed.shortDescription).toBe('Short text');
    expect(parsed.description).toBe('Long text');
  });

  it('omits fields that are missing from the response', () => {
    const parsed = parseAiAssistChgResponse('SHORT_DESCRIPTION: Only this one');
    expect(parsed).toEqual({ shortDescription: 'Only this one' });
  });

  it('returns an empty object for non-string input', () => {
    expect(parseAiAssistChgResponse(undefined as unknown as string)).toEqual({});
  });
});
