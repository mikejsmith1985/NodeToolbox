// releaseRovoNotes.test.ts — Unit tests for the hidden release-notes Rovo prompt helpers.

import { describe, expect, it } from 'vitest';

import {
  buildReleaseRovoPrompt,
  parseReleaseRovoResponse,
  type ReleaseRovoPromptInput,
} from './releaseRovoNotes.ts';

const SAMPLE_PROMPT_INPUT: ReleaseRovoPromptInput = {
  projectKey: 'TBX',
  releaseName: 'Release 26.3',
  releaseDate: '2026-05-30',
  daysLeft: 9,
  completionPercentage: 67,
  doneCount: 2,
  progressCount: 1,
  todoCount: 0,
  issues: [
    {
      issueKey: 'TBX-101',
      summary: 'Ship the release note generator',
      statusName: 'In Progress',
      assigneeName: 'Alice',
      priorityName: 'High',
      issueTypeName: 'Story',
      description: '<p>Generate the release note payload.</p>',
      acceptanceCriteria: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Given a pasted Rovo response, render a release table.' }],
          },
        ],
      },
    },
  ],
};

describe('releaseRovoNotes', () => {
  it('builds a strict JSON-oriented release prompt with normalized Jira details', () => {
    const promptText = buildReleaseRovoPrompt(SAMPLE_PROMPT_INPUT);

    expect(promptText).toContain('Respond ONLY with valid JSON.');
    expect(promptText).toContain('Release Name: Release 26.3');
    expect(promptText).toContain('Issue Key: TBX-101');
    expect(promptText).toContain('Description: Generate the release note payload.');
    expect(promptText).toContain('Acceptance Criteria: Given a pasted Rovo response, render a release table.');
    expect(promptText).toContain('"releaseSummary": "2-4 sentence overview of what this release delivers"');
  });

  it('parses a raw JSON response into a release-notes document', () => {
    const parsedDocument = parseReleaseRovoResponse(JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'Delivers the release-note workflow.',
      items: [
        {
          issueKey: 'TBX-101',
          title: 'Release note generator',
          releaseNote: 'Adds a Rovo-driven release-note authoring flow.',
          customerImpact: 'Release managers can draft release notes faster.',
          technicalDetails: 'Toolbox now parses a structured JSON response.',
          risks: 'None.',
          validation: 'Validated with unit and UI tests.',
        },
      ],
    }));

    expect(parsedDocument.releaseName).toBe('Release 26.3');
    expect(parsedDocument.items[0].issueKey).toBe('TBX-101');
    expect(parsedDocument.items[0].validation).toBe('Validated with unit and UI tests.');
  });

  it('parses a fenced json response copied from chat tools', () => {
    const parsedDocument = parseReleaseRovoResponse([
      '```json',
      JSON.stringify({
        releaseName: 'Release 26.3',
        releaseSummary: 'Ships polished release notes.',
        items: [
          {
            issueKey: 'TBX-102',
            title: 'Table rendering',
            releaseNote: 'Renders the imported output as a readable table.',
            customerImpact: 'Makes release review easier.',
            technicalDetails: 'Uses a Team Dashboard table layout.',
            risks: 'None.',
            validation: 'Reviewed in the Releases tab.',
          },
        ],
      }),
      '```',
    ].join('\n'));

    expect(parsedDocument.items).toHaveLength(1);
    expect(parsedDocument.items[0].title).toBe('Table rendering');
  });

  it('throws a helpful error when the items array is missing', () => {
    expect(() => parseReleaseRovoResponse(JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'Missing items array.',
    }))).toThrow('Rovo response must include an items array.');
  });
});
