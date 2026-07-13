// releaseDevSkipRisk.test.ts — Unit tests for the dev-skip test-risk AI Assist prompt helpers.

import { describe, expect, it } from 'vitest';

import {
  buildDevSkipRiskAssistPrompt,
  summarizeIssueCommentsForPrompt,
  type ReleaseDevSkipRiskPromptInput,
} from './releaseDevSkipRisk.ts';

const SAMPLE_INPUT: ReleaseDevSkipRiskPromptInput = {
  projectKey: 'TBX',
  releaseName: 'Release 26.4',
  releaseDate: '2026-08-01',
  daysLeft: 12,
  completionPercentage: 80,
  doneCount: 4,
  progressCount: 1,
  todoCount: 0,
  issues: [
    {
      issueKey: 'TBX-101',
      summary: 'Flip eligibility flag in reference table',
      statusName: 'Ready for Test',
      issueTypeName: 'Task',
      priorityName: 'Medium',
      description: 'Configuration change only — no application code touched.',
      acceptanceCriteria: 'Flag reads true in Integration.',
      comments: ['Dev A: Updated the DB value, no code change needed.'],
    },
    {
      issueKey: 'TBX-102',
      summary: 'Rewrite void-handling logic',
      statusName: 'In Progress',
      issueTypeName: 'Story',
      priorityName: 'High',
      description: 'Substantial change to the void-handling algorithm.',
      acceptanceCriteria: 'No duplicate void records remain.',
      comments: ['Dev B: Added unit tests covering the new branch, all green locally.'],
    },
  ],
};

describe('summarizeIssueCommentsForPrompt', () => {
  it('normalizes rich-text comment bodies into "Author: text" lines', () => {
    const summarized = summarizeIssueCommentsForPrompt([
      { id: '1', author: { displayName: 'Dev A' }, body: '<p>Ran unit tests locally.</p>' },
    ]);

    expect(summarized).toEqual(['Dev A: Ran unit tests locally.']);
  });

  it('keeps only the most recent comments when the list is long', () => {
    const manyComments = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      author: { displayName: `Dev ${index}` },
      body: `Comment ${index}`,
    }));

    const summarized = summarizeIssueCommentsForPrompt(manyComments);

    expect(summarized.length).toBeLessThan(20);
    // The final (most recent) comment must survive the trim.
    expect(summarized[summarized.length - 1]).toContain('Comment 19');
  });

  it('drops comments whose body normalizes to empty text', () => {
    const summarized = summarizeIssueCommentsForPrompt([
      { id: '1', author: { displayName: 'Dev A' }, body: '   ' },
    ]);

    expect(summarized).toEqual([]);
  });

  it('returns an empty array when there are no comments', () => {
    expect(summarizeIssueCommentsForPrompt(undefined)).toEqual([]);
    expect(summarizeIssueCommentsForPrompt([])).toEqual([]);
  });
});

describe('buildDevSkipRiskAssistPrompt', () => {
  const prompt = buildDevSkipRiskAssistPrompt(SAMPLE_INPUT);

  it('states the core question: skipping Dev-environment testing for Integration', () => {
    expect(prompt).toContain('Dev');
    expect(prompt).toContain('Integration');
  });

  it('names the low-risk heuristics: unit testing and configuration-only changes', () => {
    expect(prompt.toLowerCase()).toContain('unit test');
    expect(prompt.toLowerCase()).toContain('configuration');
  });

  it('embeds every supplied issue key, its description and its comments', () => {
    expect(prompt).toContain('TBX-101');
    expect(prompt).toContain('TBX-102');
    expect(prompt).toContain('Configuration change only');
    expect(prompt).toContain('Added unit tests covering the new branch');
  });

  it('requests a Markdown response with a per-ticket risk table', () => {
    expect(prompt).toContain('Markdown');
    expect(prompt).toContain('| Ticket |');
    expect(prompt).toContain('Dev-Skip Risk');
  });

  it('defines a Low / Medium / High risk scale', () => {
    expect(prompt).toContain('Low');
    expect(prompt).toContain('Medium');
    expect(prompt).toContain('High');
  });

  it('handles a release with no linked issues without throwing', () => {
    const emptyPrompt = buildDevSkipRiskAssistPrompt({ ...SAMPLE_INPUT, issues: [] });
    expect(emptyPrompt).toContain('no Jira issues');
  });
});
