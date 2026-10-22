// promptBudget.test.ts — Proves a Wizard prompt is fitted inside an AI chat box's limit by cutting only the Jira details,
// evenly and with a marker naming where the rest is (GH #475: 134,856 characters against Copilot's 128,000).

import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';
import {
  ASSISTANT_PROMPT_CHARACTER_LIMIT, buildIssueDetailTextWithin, describePromptOverLimit, fitPromptToBudget,
} from './promptBudget.ts';

function buildIssue(issueKey: string, descriptionLength: number): JiraIssue {
  return { key: issueKey, fields: { summary: `Summary ${issueKey}`, description: 'x'.repeat(descriptionLength) } } as unknown as JiraIssue;
}

describe('buildIssueDetailTextWithin', () => {
  it('leaves details that fit untouched', () => {
    const fitted = buildIssueDetailTextWithin([buildIssue('A-1', 100)], 5_000);
    expect(fitted.trimmedIssueKeys).toEqual([]);
    expect(fitted.text).toContain('[A-1] Summary A-1');
  });

  it('cuts only the long issues, to one length, each saying where the rest is', () => {
    const fitted = buildIssueDetailTextWithin([buildIssue('A-1', 200), buildIssue('A-2', 20_000), buildIssue('A-3', 30_000)], 10_000);
    expect(fitted.text.length).toBeLessThanOrEqual(10_000);
    expect(fitted.trimmedIssueKeys).toEqual(['A-2', 'A-3']);
    expect(fitted.text).toContain('the rest is on A-3 in Jira]');
    const [, secondBlock, thirdBlock] = fitted.text.split('\n\n');
    expect(Math.abs(secondBlock.length - thirdBlock.length)).toBeLessThanOrEqual(2);
    expect(fitted.text).toContain(`Description: ${'x'.repeat(200)}`);
  });
});

describe('fitPromptToBudget', () => {
  const buildPrompt = (issueDetailText: string) => `RULES ${'r'.repeat(1_000)}\n${issueDetailText}\nREPLY FORMAT`;

  it('builds the whole prompt when it fits, and cuts the details by the overflow when it does not', () => {
    expect(fitPromptToBudget([buildIssue('A-1', 50)], buildPrompt, 5_000).trimmedIssueKeys).toEqual([]);
    const fitted = fitPromptToBudget([buildIssue('A-1', 6_000), buildIssue('A-2', 6_000)], buildPrompt, 5_000);
    expect(fitted.promptText.length).toBeLessThanOrEqual(5_000);
    expect(fitted.promptText.startsWith('RULES')).toBe(true);
    expect(fitted.promptText.endsWith('REPLY FORMAT')).toBe(true);
    expect(fitted.trimmedIssueKeys).toEqual(['A-1', 'A-2']);
  });
});

describe('describePromptOverLimit', () => {
  it('warns only past the chat box limit', () => {
    expect(describePromptOverLimit('short')).toBe('');
    expect(describePromptOverLimit('y'.repeat(ASSISTANT_PROMPT_CHARACTER_LIMIT + 1))).toContain('128,001 characters — more than the 128,000');
  });
});
