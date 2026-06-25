// releaseRovoNotes.test.ts — Unit tests for the hidden release-notes Rovo prompt helpers.

import { describe, expect, it } from 'vitest';

import {
  buildReleaseNotesHeading,
  buildReleaseNotesHtml,
  buildReleaseRovoPrompt,
  parseReleaseRovoResponse,
  type ReleaseRovoPromptInput,
  type ReleaseRovoTableDocument,
} from './releaseRovoNotes.ts';

const SAMPLE_RELEASE_DOCUMENT: ReleaseRovoTableDocument = {
  releaseName: '06/23/2026',
  releaseSummary: 'Improves data accuracy across the Team Dashboard.',
  items: [
    {
      issueKey: 'ENFCT-1696',
      title: 'Fix duplicate SBEL eligibility records',
      releaseNote: 'Resolved duplicate eligibility records for the same effective date.',
      customerImpact: 'Prevents duplicate data downstream.',
      technicalDetails: 'Updated SBEL void handling logic.',
      risks: 'None.',
      validation: 'Validated via query checks.',
    },
  ],
};

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

  it('parses a response that has conversational text before and after the JSON (Copilot style)', () => {
    // Copilot frequently ignores "JSON only" and adds a greeting plus a sign-off with no code fence.
    const parsedDocument = parseReleaseRovoResponse([
      'Sure! Here are the release notes you asked for:',
      '',
      JSON.stringify({
        releaseName: 'Release 26.4',
        releaseSummary: 'Improves the import flow.',
        items: [
          {
            issueKey: 'TBX-200',
            title: 'Resilient import',
            releaseNote: 'Tolerates assistant chatter around the JSON payload.',
            customerImpact: 'Release managers stop seeing parse errors.',
            technicalDetails: 'Extraction narrows to the outermost JSON object.',
            risks: 'None.',
            validation: 'Covered by unit tests.',
          },
        ],
      }),
      '',
      'Let me know if you would like any changes!',
    ].join('\n'));

    expect(parsedDocument.items).toHaveLength(1);
    expect(parsedDocument.items[0].issueKey).toBe('TBX-200');
  });

  it('parses a plain triple-backtick fence with no json language tag', () => {
    // Copilot sometimes opens a bare ``` fence instead of the ```json fence Rovo used.
    const parsedDocument = parseReleaseRovoResponse([
      '```',
      JSON.stringify({
        releaseName: 'Release 26.4',
        releaseSummary: 'Handles untagged fences.',
        items: [
          {
            issueKey: 'TBX-201',
            title: 'Untagged fence support',
            releaseNote: 'Reads JSON from a bare code fence.',
            customerImpact: 'Fewer failed imports.',
            technicalDetails: 'Fence pattern no longer requires the json tag.',
            risks: 'None.',
            validation: 'Reviewed in unit tests.',
          },
        ],
      }),
      '```',
    ].join('\n'));

    expect(parsedDocument.items[0].issueKey).toBe('TBX-201');
  });

  it('instructs the assistant to emit only the JSON object with no surrounding text', () => {
    const promptText = buildReleaseRovoPrompt(SAMPLE_PROMPT_INPUT);

    expect(promptText).toContain('Output the JSON object only');
    expect(promptText).toContain('Do not add any text before or after the JSON');
  });

  it('builds a release-notes heading from the team name and fix version', () => {
    expect(buildReleaseNotesHeading('Transformers', '06/23/2026')).toBe('Transformers 06/23/2026 Release Notes');
  });

  it('omits the team segment when no team name is provided', () => {
    expect(buildReleaseNotesHeading('', '06/23/2026')).toBe('06/23/2026 Release Notes');
  });

  it('trims surrounding whitespace on both the team name and fix version', () => {
    expect(buildReleaseNotesHeading('  Transformers  ', '  06/23/2026  ')).toBe('Transformers 06/23/2026 Release Notes');
  });

  it('never mentions how the notes were drafted (no AI/Rovo wording)', () => {
    const heading = buildReleaseNotesHeading('Transformers', '06/23/2026');
    expect(heading).not.toMatch(/rovo|\bai\b|assistant|draft/i);
  });

  it('builds an inline-styled HTML table with the heading, summary, and every column', () => {
    const html = buildReleaseNotesHtml('Transformers 06/23/2026 Release Notes', SAMPLE_RELEASE_DOCUMENT);

    expect(html).toContain('<h2 style="font-size:18px');
    expect(html).toContain('Transformers 06/23/2026 Release Notes');
    expect(html).toContain('Improves data accuracy across the Team Dashboard.');
    // All six column headers are present.
    for (const columnLabel of ['Release Item', 'Release Note', 'Customer Impact', 'Technical Details', 'Risks', 'Validation']) {
      expect(html).toContain(`>${columnLabel}</th>`);
    }
    // The row pairs the bold issue key with the title and includes the remaining cell values.
    expect(html).toContain('<strong>ENFCT-1696</strong>');
    expect(html).toContain('Fix duplicate SBEL eligibility records');
    expect(html).toContain('Validated via query checks.');
    // Inline styles only — no class attributes that email clients would drop.
    expect(html).toContain('border-collapse:collapse');
    expect(html).not.toContain('class=');
  });

  it('escapes HTML in release-notes content so values cannot break the table markup', () => {
    const documentWithMarkup: ReleaseRovoTableDocument = {
      ...SAMPLE_RELEASE_DOCUMENT,
      items: [{ ...SAMPLE_RELEASE_DOCUMENT.items[0], title: 'Handle <script> & "quoted" tags' }],
    };
    const html = buildReleaseNotesHtml('06/23/2026 Release Notes', documentWithMarkup);

    expect(html).toContain('Handle &lt;script&gt; &amp; &quot;quoted&quot; tags');
    expect(html).not.toContain('<script>');
  });

  it('produces report HTML with no mention of how the notes were drafted', () => {
    const html = buildReleaseNotesHtml('Transformers 06/23/2026 Release Notes', SAMPLE_RELEASE_DOCUMENT);
    // The static chrome (heading suffix, column labels, styles) carries no AI/Rovo wording.
    expect(html.replace(/Release Notes/g, '')).not.toMatch(/rovo|\bai\b|assistant|draft/i);
  });

  it('throws a helpful error when the items array is missing', () => {
    expect(() => parseReleaseRovoResponse(JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'Missing items array.',
    }))).toThrow('Rovo response must include an items array.');
  });
});
