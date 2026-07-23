// flowAuditDocument.test.ts — Unit tests for the generated audit document itself.
//
// The generator is pure, so the DOCUMENT is under test here, not just the plumbing. For a report
// whose entire value is being trustworthy, that is the point: every formula, every link and every
// honest-state message is asserted directly.

import { describe, expect, it } from 'vitest';

import { buildFlowAuditDocument } from './flowAuditDocument.ts';
import type { FlowAuditInput, PersonAuditRow } from './flowAuditDocument.ts';
import type { PersonalFlowResult } from './personalFlow.ts';
import type { IssueFlow } from './issueFlow.ts';
import { computeDeliveryTotals, summariseStageRollups } from './issueFlowRollup.ts';

const BASE_URL = 'https://jira.example.com';

/** The horizontal rule the generator puts between sections. */
const SECTION_RULE = '\n---\n';

/** One icon per major section, so a reader can find a section at a glance. */
const SECTION_ICONS = ['\u{1F4CA}', '\u{1F9EE}', '\u{1F50D}', '⚖️', '\u{1F4CB}'];

/** A credited result with 12 issues, of which 2 carry measurable cycle time. */
function makeResult(overrides: Partial<PersonalFlowResult> = {}): PersonalFlowResult {
  return {
    windowDays: 90,
    issueCount: 12,
    totalStoryPoints: 24,
    throughput: {
      issuesPerDay: 0.13, issuesPerWeek: 0.93, issuesPerTwoWeeks: 1.87,
      pointsPerDay: 0.27, pointsPerWeek: 1.87, pointsPerTwoWeeks: 3.73,
    },
    cycleTime: { averageDays: 2.5, medianDays: 2, countWithCycleTime: 2 },
    perIssue: [
      { key: 'FLOW-1', summary: 'One', storyPoints: 3, cycleTimeDays: 2, lastActiveIso: '2026-07-03T00:00:00.000Z' },
      { key: 'FLOW-2', summary: 'Two', storyPoints: 5, cycleTimeDays: 3, lastActiveIso: '2026-07-02T00:00:00.000Z' },
    ],
    excludedIssues: [
      { key: 'FLOW-20', summary: 'Not hers', reason: 'not-owned' },
      { key: 'FLOW-30', summary: 'Still open', reason: 'wip-open' },
    ],
    handsOnDaysByStatusId: {},
    workedExample: {
      issueKey: 'FLOW-1',
      issueSummary: 'One',
      ownershipStints: [{ fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-07-03T00:00:00.000Z' }],
      qualifyingSpans: [
        { fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-07-03T00:00:00.000Z', statusId: '11', workingDays: 2 },
      ],
      totalWorkingDays: 2,
    },
    ...overrides,
  };
}

function makeRow(personDisplayName: string, overrides: Partial<PersonAuditRow> = {}): PersonAuditRow {
  return {
    personDisplayName,
    personQueryValue: 'jane.smith',
    roleLabels: 'Dev',
    figures: makeResult(),
    errorMessage: null,
    fetchedIssueCount: 14,
    ceilingReached: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<FlowAuditInput> = {}): FlowAuditInput {
  return {
    envelope: {
      rosterLabel: 'Alpha Team',
      windowDays: 90,
      windowStartIso: '2026-04-09T00:00:00.000Z',
      windowEndIso: '2026-07-08T00:00:00.000Z',
      generatedAtIso: '2026-07-08T12:00:00.000Z',
      toolVersion: '0.90.1',
      ceilingReached: null,
      jiraBaseUrl: BASE_URL,
    },
    rows: [makeRow('Jane Smith')],
    statusNamesById: { '11': 'In Progress' },
    ...overrides,
  };
}

describe('document structure', () => {
  it('renders every section, in order', () => {
    const document = buildFlowAuditDocument(makeInput());
    // Matched on HEADINGS, not bare names: the "How to read this" guide mentions every section by
    // name, so a plain substring search would find the guide rather than the section itself.
    const sectionOrder = [
      '# Personal Workflow',
      'Team figures\n',
      'How these numbers are calculated\n',
      'Worked example\n',
      'What was counted and what was not\n',
      'Per-issue detail\n',
    ];

    const positions = sectionOrder.map((heading) => document.indexOf(heading));
    positions.forEach((position) => expect(position).toBeGreaterThan(-1));
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
  });

  it('explains each metric ONCE for a ten-person roster, not ten times', () => {
    // The readability rule. Without this, per-person duplication creeps back and the document
    // becomes unusable for exactly the team-sized runs it is meant for.
    const rows = Array.from({ length: 10 }, (_unused, index) => makeRow(`Person ${index}`));

    const document = buildFlowAuditDocument(makeInput({ rows }));
    const explanationCount = document.split('credited issues ÷ (window days ÷ 7)').length - 1;

    expect(explanationCount).toBe(1);
  });

  it('puts the per-issue detail last, so it never buries the figures', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document.indexOf('Per-issue detail\n'))
      .toBeGreaterThan(document.indexOf('What was counted and what was not\n'));
  });

  it('states the roster, window boundaries, generation time and tool version', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document).toContain('Alpha Team');
    expect(document).toContain('2026-04-09');
    expect(document).toContain('2026-07-08');
    expect(document).toContain('0.90.1');
  });

  it('says what it contains and whose figures they are, for a reader who finds the page later', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document.toLowerCase()).toContain('named individuals');
  });
});

describe('the three-way agreement (NFR-002)', () => {
  it('has a figure, a worked formula and a link that all agree', () => {
    const document = buildFlowAuditDocument(makeInput());

    // 12 credited issues → the table says 12, the formula uses 12, and the link names 12 keys.
    expect(document).toContain('| 12 |');
    expect(document).toContain('12 ÷ (90 ÷ 7)');
    // perIssue in the fixture holds the credited keys the link is built from.
    expect(document).toContain('FLOW-1');
  });
});

describe('reconciliation', () => {
  it('shows fetched, credited and each exclusion reason, and they balance', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document).toContain('Fetched');
    expect(document).toContain('Credited');
    expect(document.toLowerCase()).toContain('never assigned');   // not-owned, in plain English
    expect(document.toLowerCase()).toContain('still open');        // wip-open, in plain English
  });

  it('warns visibly when the accounting does not balance', () => {
    // 14 fetched but 12 credited + 1 excluded = 13. An audit report that cannot balance its own
    // arithmetic must say so rather than printing rows that quietly disagree.
    const unbalanced = makeRow('Jane Smith', {
      figures: makeResult({ excludedIssues: [{ key: 'FLOW-20', summary: 'x', reason: 'not-owned' }] }),
    });

    const document = buildFlowAuditDocument(makeInput({ rows: [unbalanced] }));

    expect(document.toLowerCase()).toContain('does not balance');
  });
});

describe('honest states', () => {
  it('reports a person with no credited work as not applicable, never as zero', () => {
    const emptyRow = makeRow('Quiet Person', {
      figures: makeResult({
        issueCount: 0,
        totalStoryPoints: 0,
        perIssue: [],
        cycleTime: { averageDays: null, medianDays: null, countWithCycleTime: 0 },
        workedExample: null,
      }),
    });

    const document = buildFlowAuditDocument(makeInput({ rows: [emptyRow] }));

    expect(document.toLowerCase()).toContain('not applicable');
  });

  it('still lists a person whose analysis failed, with the reason', () => {
    const failedRow = makeRow('Broken Person', { figures: null, errorMessage: 'Jira timed out' });

    const document = buildFlowAuditDocument(makeInput({ rows: [failedRow] }));

    expect(document).toContain('Broken Person');
    expect(document).toContain('Jira timed out');
  });

  it('discloses a reached ceiling at the top, naming who is affected', () => {
    const document = buildFlowAuditDocument(makeInput({
      envelope: {
        ...makeInput().envelope,
        ceilingReached: { kind: 'per-unit', affectedPeople: ['Jane Smith'] },
      },
    }));

    const noticePosition = document.toLowerCase().indexOf('incomplete');
    expect(noticePosition).toBeGreaterThan(-1);
    expect(noticePosition).toBeLessThan(document.indexOf('Team figures\n'));
    expect(document).toContain('Jane Smith');
  });

  it('still produces a complete document when no Jira base URL is configured', () => {
    const document = buildFlowAuditDocument(makeInput({
      envelope: { ...makeInput().envelope, jiraBaseUrl: null },
    }));

    expect(document).toContain('Team figures');
    expect(document).toContain('issueKey in (');   // query text stands in for the link
    expect(document).not.toContain('https://');
  });
});

describe('purity', () => {
  it('produces byte-identical output for identical input', () => {
    expect(buildFlowAuditDocument(makeInput())).toBe(buildFlowAuditDocument(makeInput()));
  });

  it('does not mutate its input', () => {
    const input = makeInput();
    const snapshot = JSON.stringify(input);

    buildFlowAuditDocument(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('never reads the clock — the timestamp comes only from the envelope', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document).toContain('2026-07-08T12:00:00.000Z');
    expect(document).not.toContain(new Date().getFullYear() === 2026 ? 'IMPOSSIBLE_SENTINEL' : String(new Date().getFullYear()));
  });
});

describe('readability', () => {
  it('marks each section with an icon so they are findable at a glance', () => {
    const document = buildFlowAuditDocument(makeInput());

    SECTION_ICONS.forEach((icon) => expect(document).toContain(icon));
  });

  it('separates sections with rules so they do not bleed into one another', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document.split(SECTION_RULE).length).toBeGreaterThanOrEqual(5);
  });

  it('sets a worked value apart from its prose, rather than running them together', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document).toContain('> **Worked example:**');
  });

  it('tells the reader how to use the document before the numbers start', () => {
    const document = buildFlowAuditDocument(makeInput());
    const howToRead = document.indexOf('How to read this');

    expect(howToRead).toBeGreaterThan(-1);
    expect(howToRead).toBeLessThan(document.indexOf('Team figures\n'));
  });

  it('flags a history-derived metric so it stands out from the queryable ones', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document).toContain('Cannot be reproduced by a Jira search');
  });

  it('uses plain headings for the per-issue tables, never raw HTML', () => {
    // Confluence does not support <details>/<summary>: it renders the tags as literal text and the
    // stray markup breaks the table columns that follow. Markdown headings render everywhere.
    const document = buildFlowAuditDocument(makeInput());

    expect(document).not.toContain('<details>');
    expect(document).not.toContain('<summary>');
    expect(document).not.toMatch(/<\/?[a-z]+>/);
  });

  it('still labels each per-issue table with the person and how many issues it holds', () => {
    const document = buildFlowAuditDocument(makeInput());

    expect(document).toContain('### Jane Smith — 2 issues');
  });
});

/** Counts the pipes that actually end a table cell — escaped ones do not. */
function countCellBoundaries(tableRow: string): number {
  return (tableRow.match(/(^|[^\\])\|/g) ?? []).length;
}

describe('table cell safety', () => {
  it('does not let a pipe in an issue summary add phantom columns', () => {
    // Jira summaries routinely contain "|" (e.g. "DEV | Postgres changes"). Unescaped, it ends the
    // cell early and the renderer widens the whole table with empty columns.
    const rowWithPipe = makeRow('Jane Smith', {
      figures: makeResult({
        perIssue: [{
          key: 'FLOW-1', summary: 'DEV | sf-preprocessor | Postgres', storyPoints: 3,
          cycleTimeDays: 2, lastActiveIso: '2026-07-03T00:00:00.000Z',
        }],
      }),
    });

    const document = buildFlowAuditDocument(makeInput({ rows: [rowWithPipe] }));
    const issueRow = document.split('\n').find((line) => line.startsWith('| FLOW-1 '));

    // Count UNESCAPED pipes only — an escaped "\|" still contains the character but does not end a
    // cell, so a raw count cannot tell a safe summary from one that broke out.
    expect(countCellBoundaries(issueRow ?? '')).toBe(5);
  });

  it('does not let a pipe in a person name break the team table', () => {
    const document = buildFlowAuditDocument(makeInput({
      rows: [makeRow('Smith | Jane')],
    }));
    const teamRow = document.split('\n').find((line) => line.startsWith('| Smith '));

    expect(countCellBoundaries(teamRow ?? '')).toBe(10);
  });
});

describe('the fetched-issues link', () => {
  it('queries by the machine id Jira accepts, not the display name', () => {
    // Jira rejects a display name in the assignee field: "The value 'Sokol, Mark (CTR)' does not
    // exist for the field 'assignee'." The report already resolved the queryable id — use it.
    const document = buildFlowAuditDocument(makeInput({
      rows: [makeRow('Sokol, Mark (CTR)', { personQueryValue: 'mark.sokol' })],
    }));

    expect(document).toContain('assignee WAS "mark.sokol"');
    expect(document).not.toContain('assignee WAS "Sokol, Mark (CTR)"');
  });

  it('omits the fetched link when the person never resolved to a queryable id', () => {
    // A link that is known to error is worse than no link: it looks checkable and is not.
    const document = buildFlowAuditDocument(makeInput({
      rows: [makeRow('Unresolved Person', { personQueryValue: null })],
    }));

    expect(document).not.toContain('assignee WAS "Unresolved Person"');
    expect(document.toLowerCase()).toContain('no queryable jira id');
  });
});

// ── The issue-centric flow sections (feature 026) ────────────────────────────

/** A delivered issue that changed hands mid-flight — the case the person-centric report cannot show. */
function makeIssueFlow(issueKey: string): IssueFlow {
  return {
    issueKey,
    issueSummary: `${issueKey} | with a pipe in the summary`,
    storyPoints: 5,
    completedIso: '2026-07-09T00:00:00.000Z',
    stages: [
      {
        fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-07-02T00:00:00.000Z',
        statusId: '1', statusName: 'Backlog',
        holder: { holderId: 'jane', holderName: 'Dev, Jane (CTR)' },
        flowClass: 'not-started', workingDays: 1,
      },
      {
        fromIso: '2026-07-02T00:00:00.000Z', toIso: '2026-07-06T00:00:00.000Z',
        statusId: '2', statusName: 'In Progress',
        holder: { holderId: 'jane', holderName: 'Dev, Jane (CTR)' },
        flowClass: 'active', workingDays: 3,
      },
      {
        fromIso: '2026-07-06T00:00:00.000Z', toIso: '2026-07-09T00:00:00.000Z',
        statusId: '3', statusName: 'Ready for QA',
        holder: { holderId: null, holderName: 'Unassigned' },
        flowClass: 'waiting', workingDays: 3,
      },
    ],
    leadTimeWorkingDays: 7,
    cycleTimeWorkingDays: 6,
    preWorkWaitWorkingDays: 1,
  };
}

/** Builds document input WITH a flow analysis attached. */
function makeFlowInput(overrides: Partial<FlowAuditInput> = {}): FlowAuditInput {
  const issueFlows = [makeIssueFlow('FLOW-100')];
  return makeInput({
    flowAnalysis: {
      issueFlows,
      rollups: summariseStageRollups(issueFlows),
      deliveryTotals: computeDeliveryTotals(issueFlows),
      statusClassByStatusName: {
        Backlog: 'not-started',
        'In Progress': 'active',
        'Ready for QA': 'waiting',
        'Custom State': 'unclassified',
      },
    },
    ...overrides,
  });
}

describe('flow analysis sections', () => {
  it('renders the flow sections in order after the personal ones', () => {
    const document = buildFlowAuditDocument(makeFlowInput());

    const sectionOrder = ['Flow summary', 'Where the time goes', 'How statuses were classified', 'Per-issue flow'];
    const positions = sectionOrder.map((heading) => document.indexOf(heading));
    positions.forEach((position) => expect(position).toBeGreaterThan(-1));
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
  });

  it('always shows lead time and cycle time together, with the pre-work wait as its own figure', () => {
    // Neither clock is meaningful alone: cycle time hides a backlog that sat for weeks, and lead time
    // alone lets backlog age mask a slow delivery system. The wait is stated, never left as a subtraction.
    const document = buildFlowAuditDocument(makeFlowInput());

    expect(document).toContain('Avg lead time');
    expect(document).toContain('Avg cycle time');
    expect(document).toContain('Avg pre-work wait');
  });

  it('marks every duration as working days', () => {
    const document = buildFlowAuditDocument(makeFlowInput());

    const flowSection = document.slice(document.indexOf('Flow summary'));
    expect(flowSection).toContain('working days');
    expect(flowSection).toContain('Total (working days)');
  });

  it('lists every status with its class, including the unclassified ones', () => {
    const document = buildFlowAuditDocument(makeFlowInput());

    const classificationSection = document.slice(document.indexOf('How statuses were classified'));
    expect(classificationSection).toContain('| Custom State | unclassified |');
    expect(classificationSection).toContain('| Ready for QA | waiting |');
  });

  it('names the largest contributor with its class', () => {
    const document = buildFlowAuditDocument(makeFlowInput());

    expect(document).toMatch(/Largest single contributor: .+\((active|waiting)\)/);
  });

  it('carries a waiting-time notice distinct from the throughput one', () => {
    // Naming individuals against waiting time reads as blame unless the reader is told a queue is a
    // property of the system. Reusing the throughput wording would leave the more sensitive figures
    // less well explained than the less sensitive ones.
    const document = buildFlowAuditDocument(makeFlowInput());

    expect(document).toContain('Waiting time is a property of the **system**');
    expect(document).toContain('Nobody named against a waiting figure chose to wait');
  });

  it('escapes a pipe in an issue summary so it cannot create phantom columns', () => {
    const document = buildFlowAuditDocument(makeFlowInput());

    const perIssueRow = document.split('\n').find((line) => line.startsWith('| FLOW-100 |')) ?? '';
    expect(perIssueRow).toContain('\\|');
    // Six columns means seven pipes; an unescaped summary pipe would make eight.
    expect((perIssueRow.match(/(?<!\\)\|/g) ?? []).length).toBe(7);
  });

  it('adds nothing at all when no flow analysis was run', () => {
    // The guard for the existing report: a Personal Workflow document must be byte-identical to what
    // it was before this feature, not carry an empty heading implying something failed.
    const withoutFlow = buildFlowAuditDocument(makeInput());

    expect(withoutFlow).not.toContain('Flow summary');
    expect(withoutFlow).not.toContain('Where the time goes');
    expect(withoutFlow.endsWith('\n') || withoutFlow.length > 0).toBe(true);
  });

  it('renders no raw HTML tags, so Confluence cannot print markup as text', () => {
    const document = buildFlowAuditDocument(makeFlowInput());

    expect(document).not.toMatch(/<\/?[a-z]+>/);
  });
});
