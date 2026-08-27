// releaseAiAssistNotes.test.ts — Unit tests for the hidden release-notes AI Assist prompt helpers.

import { describe, expect, it } from 'vitest';

import {
  buildReleaseNotesHeading,
  buildReleaseNotesHtml,
  buildReleaseAiAssistPrompt,
  parseReleaseAiAssistResponse,
  type ReleaseAiAssistPromptInput,
  type ReleaseAiAssistTableDocument,
} from './releaseAiAssistNotes.ts';

const SAMPLE_RELEASE_DOCUMENT: ReleaseAiAssistTableDocument = {
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

const SAMPLE_PROMPT_INPUT: ReleaseAiAssistPromptInput = {
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
      featureKey: 'TBX-1',
      featureSummary: 'Release note generation',
      description: '<p>Generate the release note payload.</p>',
      acceptanceCriteria: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Given a pasted AI Assist response, render a release table.' }],
          },
        ],
      },
    },
  ],
};

describe('releaseAiAssistNotes', () => {
  it('builds a strict JSON-oriented release prompt with normalized Jira details', () => {
    const promptText = buildReleaseAiAssistPrompt(SAMPLE_PROMPT_INPUT);

    expect(promptText).toContain('Respond ONLY with valid JSON.');
    expect(promptText).toContain('Release Name: Release 26.3');
    expect(promptText).toContain('Issue Key: TBX-101');
    expect(promptText).toContain('Description: Generate the release note payload.');
    expect(promptText).toContain('Acceptance Criteria: Given a pasted AI Assist response, render a release table.');
    expect(promptText).toContain('"releaseSummary": "2-4 sentence overview of what this release delivers"');
  });

  it('parses a raw JSON response into a release-notes document', () => {
    const parsedDocument = parseReleaseAiAssistResponse(JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'Delivers the release-note workflow.',
      items: [
        {
          issueKey: 'TBX-101',
          title: 'Release note generator',
          releaseNote: 'Adds an AI Assist-driven release-note authoring flow.',
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
    const parsedDocument = parseReleaseAiAssistResponse([
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
    const parsedDocument = parseReleaseAiAssistResponse([
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
    // Copilot sometimes opens a bare ``` fence instead of the ```json fence AI Assist used.
    const parsedDocument = parseReleaseAiAssistResponse([
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
    const promptText = buildReleaseAiAssistPrompt(SAMPLE_PROMPT_INPUT);

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

  it('never mentions how the notes were drafted (no AI/AI Assist wording)', () => {
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
    const documentWithMarkup: ReleaseAiAssistTableDocument = {
      ...SAMPLE_RELEASE_DOCUMENT,
      items: [{ ...SAMPLE_RELEASE_DOCUMENT.items[0], title: 'Handle <script> & "quoted" tags' }],
    };
    const html = buildReleaseNotesHtml('06/23/2026 Release Notes', documentWithMarkup);

    expect(html).toContain('Handle &lt;script&gt; &amp; &quot;quoted&quot; tags');
    expect(html).not.toContain('<script>');
  });

  it('produces report HTML with no mention of how the notes were drafted', () => {
    const html = buildReleaseNotesHtml('Transformers 06/23/2026 Release Notes', SAMPLE_RELEASE_DOCUMENT);
    // The static chrome (heading suffix, column labels, styles) carries no AI/AI Assist wording.
    expect(html.replace(/Release Notes/g, '')).not.toMatch(/rovo|\bai\b|assistant|draft/i);
  });

  it('throws a helpful error when the items array is missing', () => {
    expect(() => parseReleaseAiAssistResponse(JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'Missing items array.',
    }))).toThrow('AI Assist response must include an items array.');
  });
});

describe('release notes carry the Feature each item delivers', () => {
  it('states each item\'s Feature in the prompt, so a Feature\'s work reads together', () => {
    const prompt = buildReleaseAiAssistPrompt(SAMPLE_PROMPT_INPUT);

    expect(prompt).toContain('Feature: TBX-1 — Release note generation');
    expect(prompt).toContain('grouped by the Feature they deliver');
  });

  it('names an item with no Feature rather than leaving the line blank', () => {
    const prompt = buildReleaseAiAssistPrompt({
      ...SAMPLE_PROMPT_INPUT,
      issues: [{ ...SAMPLE_PROMPT_INPUT.issues[0], featureKey: null, featureSummary: '' }],
    });

    expect(prompt).toContain('Feature: (none — this item is not linked to a Feature)');
  });

  it('falls back to the bare key when the Feature summary could not be read', () => {
    const prompt = buildReleaseAiAssistPrompt({
      ...SAMPLE_PROMPT_INPUT,
      issues: [{ ...SAMPLE_PROMPT_INPUT.issues[0], featureKey: 'TBX-1', featureSummary: '' }],
    });

    expect(prompt).toContain('Feature: TBX-1');
  });

  it('forbids the assistant from regrouping, because that is already settled', () => {
    // Toolbox resolved each item's Feature from Jira. An assistant that regrouped could quietly
    // disagree, and a release note that misattributes work is worse than one that never grouped.
    const prompt = buildReleaseAiAssistPrompt(SAMPLE_PROMPT_INPUT);

    expect(prompt).toContain('Do NOT decide which item belongs to which Feature');
    expect(prompt).toContain('featureNarratives');
  });
});

describe('parseReleaseAiAssistResponse — per-Feature narratives', () => {
  /** A minimal valid reply, plus whatever the test adds. */
  function replyWith(extraFields: Record<string, unknown>): string {
    return JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'A summary of the release.',
      items: [{
        issueKey: 'TBX-101',
        title: 'A title',
        releaseNote: 'What changed.',
        customerImpact: 'Why it matters.',
        technicalDetails: 'How it works.',
        risks: 'None.',
        validation: 'Validated.',
      }],
      ...extraFields,
    });
  }

  it('reads a narrative per Feature', () => {
    const parsed = parseReleaseAiAssistResponse(replyWith({
      featureNarratives: [{ featureKey: 'TBX-1', narrative: 'Completes intake for batch senders.' }],
    }));

    expect(parsed.featureNarratives).toEqual([
      { featureKey: 'TBX-1', narrative: 'Completes intake for batch senders.' },
    ]);
  });

  it('imports a reply that carried no narratives at all', () => {
    // A reply pasted before this existed, or from an assistant that skipped the section, must still
    // produce the table it always did.
    expect(parseReleaseAiAssistResponse(replyWith({})).featureNarratives).toEqual([]);
  });

  it('skips a malformed narrative rather than losing the whole table to it', () => {
    // The narratives are commentary on a table that is already complete without them.
    const parsed = parseReleaseAiAssistResponse(replyWith({
      featureNarratives: [{ featureKey: '', narrative: 'No key' }, { featureKey: 'TBX-1', narrative: 'Good one.' }],
    }));

    expect(parsed.featureNarratives).toEqual([{ featureKey: 'TBX-1', narrative: 'Good one.' }]);
    expect(parsed.items).toHaveLength(1);
  });

  it('keeps the first narrative when a Feature was described twice', () => {
    const parsed = parseReleaseAiAssistResponse(replyWith({
      featureNarratives: [
        { featureKey: 'TBX-1', narrative: 'First.' },
        { featureKey: 'TBX-1', narrative: 'Second.' },
      ],
    }));

    expect(parsed.featureNarratives).toEqual([{ featureKey: 'TBX-1', narrative: 'First.' }]);
  });
});

describe('buildReleaseNotesHtml — grouped for email', () => {
  const releaseDocument = {
    releaseName: 'Release 26.3',
    releaseSummary: 'A summary.',
    items: [
      { issueKey: 'TBX-1', title: 'One', releaseNote: 'a', customerImpact: 'b', technicalDetails: 'c', risks: 'd', validation: 'e' },
      { issueKey: 'TBX-2', title: 'Two', releaseNote: 'a', customerImpact: 'b', technicalDetails: 'c', risks: 'd', validation: 'e' },
    ],
  };

  const groups = [
    {
      featureKey: 'FEAT-10',
      featureSummary: 'Online enrollment intake',
      narrative: 'Completes intake.',
      rows: [releaseDocument.items[0]],
    },
    { featureKey: 'FEAT-20', featureSummary: '', narrative: '', rows: [releaseDocument.items[1]] },
  ];

  it('heads each group with its Feature, and carries the narrative under it', () => {
    const html = buildReleaseNotesHtml('Team 06/23/2026 Release Notes', releaseDocument, groups);

    expect(html).toContain('FEAT-10 — Online enrollment intake');
    expect(html).toContain('Completes intake.');
    expect(html).toContain('FEAT-20');
  });

  it('spans the heading across every column so the rows read as one Feature\'s worth', () => {
    const html = buildReleaseNotesHtml('Heading', releaseDocument, groups);

    expect(html).toContain('colspan="6"');
  });

  it('renders the flat table it always did when there is nothing to group by', () => {
    const html = buildReleaseNotesHtml('Heading', releaseDocument, []);

    expect(html).not.toContain('colspan="6"');
    expect(html).toContain('TBX-1');
    expect(html).toContain('TBX-2');
  });

  it('shows every item exactly once when grouped', () => {
    const html = buildReleaseNotesHtml('Heading', releaseDocument, groups);

    expect(html.match(/<strong>TBX-1<\/strong>/g)).toHaveLength(1);
    expect(html.match(/<strong>TBX-2<\/strong>/g)).toHaveLength(1);
  });

  it('escapes a Feature summary so it cannot break out of the table', () => {
    const html = buildReleaseNotesHtml('Heading', releaseDocument, [
      { ...groups[0], featureSummary: '<script>alert(1)</script>' },
      groups[1],
    ]);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
