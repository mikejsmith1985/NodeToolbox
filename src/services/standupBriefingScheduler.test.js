// src/services/standupBriefingScheduler.test.js — Unit tests for the standup briefing scheduler.
//
// Tests cover all pure analysis and rendering functions.
// No mocks needed — all tested functions operate on plain data structures.

'use strict';

const {
  renderMarkdownTable,
  extractStatusChanges,
  extractCompletions,
  analyseIssues,
  buildBriefingMarkdown,
  extractSprintName,
  calculateDaysBlocked,
  isCompletedStatus,
  isBlockedStatus,
  hasBlockingLink,
  buildStandupAiAssistPrompt,
  buildAiAssistInsightPanel,
} = require('./standupBriefingScheduler');

// ── AI Assist insight enrichment (US1) ──

describe('buildStandupAiAssistPrompt', () => {
  it('includes the team name and the briefing text', () => {
    const prompt = buildStandupAiAssistPrompt('Blocked: ABC-1 is stuck', 'Transformers');
    expect(prompt).toContain('Transformers');
    expect(prompt).toContain('Blocked: ABC-1 is stuck');
    expect(prompt).toContain('insight block');
  });
});

describe('buildAiAssistInsightPanel', () => {
  it('wraps text in an info macro, escapes XML, and splits paragraphs', () => {
    const html = buildAiAssistInsightPanel('Ship <now>\n\nSecond & final');
    expect(html).toContain('<ac:structured-macro ac:name="info">');
    expect(html).toContain('🤖 AI Assist insight');
    expect(html).toContain('Ship &lt;now&gt;');     // escaped
    expect(html).toContain('Second &amp; final');   // escaped, second paragraph
    expect((html.match(/<p>/g) || []).length).toBeGreaterThanOrEqual(3); // heading + 2 paragraphs
  });
});

// ── renderMarkdownTable ──

describe('renderMarkdownTable', () => {
  it('returns an italic empty message when rows is empty', () => {
    const result = renderMarkdownTable(['Key', 'Summary'], ['issueKey', 'summary'], [], 'Nothing here.');
    expect(result).toBe('_Nothing here._\n');
  });

  it('renders header row, separator row, and data rows', () => {
    const rows = [{ issueKey: 'ABC-1', summary: 'Fix bug' }];
    const result = renderMarkdownTable(['Key', 'Summary'], ['issueKey', 'summary'], rows, '');
    expect(result).toContain('| Key | Summary |');
    expect(result).toContain('|---|---|');
    expect(result).toContain('| ABC-1 | Fix bug |');
  });

  it('escapes pipe characters in cell values', () => {
    const rows = [{ issueKey: 'ABC-1', summary: 'A | B' }];
    const result = renderMarkdownTable(['Key', 'Summary'], ['issueKey', 'summary'], rows, '');
    expect(result).toContain('A \\| B');
  });

  it('renders a dash for missing field keys', () => {
    const rows = [{ issueKey: 'ABC-1' }];
    const result = renderMarkdownTable(['Key', 'Summary'], ['issueKey', 'summary'], rows, '');
    expect(result).toContain('| — |');
  });

  it('handles multiple rows correctly', () => {
    const rows = [
      { issueKey: 'A-1', summary: 'First' },
      { issueKey: 'A-2', summary: 'Second' },
    ];
    const result = renderMarkdownTable(['Key', 'Summary'], ['issueKey', 'summary'], rows, '');
    expect(result).toContain('| A-1 | First |');
    expect(result).toContain('| A-2 | Second |');
  });
});

// ── isCompletedStatus / isBlockedStatus ──

describe('isCompletedStatus', () => {
  it.each([
    ['Done', true],
    ['Closed', true],
    ['Resolved', true],
    ['Complete', true],
    ['Accepted', true],
    ['DONE', true],
    ['In Progress', false],
    ['To Do', false],
    ['Review', false],
  ])('returns %s for "%s"', (statusName, expected) => {
    expect(isCompletedStatus(statusName)).toBe(expected);
  });
});

describe('isBlockedStatus', () => {
  it.each([
    ['Blocked', true],
    ['Blocked by External', true],
    ['Impeded', true],
    ['On Hold', true],
    ['In Progress', false],
    ['Done', false],
  ])('returns %s for "%s"', (statusName, expected) => {
    expect(isBlockedStatus(statusName)).toBe(expected);
  });
});

// ── hasBlockingLink ──

describe('hasBlockingLink', () => {
  it('returns false when there are no issue links', () => {
    const issue = { fields: { issuelinks: [] } };
    expect(hasBlockingLink(issue)).toBe(false);
  });

  it('returns true when a link type inward name contains "block"', () => {
    const issue = {
      fields: {
        issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' } }],
      },
    };
    expect(hasBlockingLink(issue)).toBe(true);
  });

  it('returns false for non-blocking link types', () => {
    const issue = {
      fields: {
        issuelinks: [{ type: { inward: 'relates to', outward: 'relates to' } }],
      },
    };
    expect(hasBlockingLink(issue)).toBe(false);
  });
});

// ── extractStatusChanges ──

describe('extractStatusChanges', () => {
  const cutoffDate = new Date('2026-06-11T00:00:00Z');

  it('returns empty array when the issue has no changelog', () => {
    const issue = { key: 'A-1', fields: { summary: 'Test', assignee: null }, changelog: undefined };
    expect(extractStatusChanges(issue, cutoffDate)).toHaveLength(0);
  });

  it('returns empty array when all history entries are before the cutoff', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'Test', assignee: null },
      changelog: {
        histories: [{
          created: '2026-06-09T10:00:00Z',
          items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
        }],
      },
    };
    expect(extractStatusChanges(issue, cutoffDate)).toHaveLength(0);
  });

  it('extracts a status change within the window', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'My issue', assignee: { displayName: 'Alice' } },
      changelog: {
        histories: [{
          created: '2026-06-12T10:00:00Z',
          items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
        }],
      },
    };
    const result = extractStatusChanges(issue, cutoffDate);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      issueKey:   'A-1',
      summary:    'My issue',
      assignee:   'Alice',
      fromStatus: 'To Do',
      toStatus:   'In Progress',
    });
  });

  it('ignores changelog items where toString is null or empty', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'Test', assignee: null },
      changelog: {
        histories: [{
          created: '2026-06-12T10:00:00Z',
          items: [{ field: 'status', fromString: 'In Progress', toString: null }],
        }],
      },
    };
    expect(extractStatusChanges(issue, cutoffDate)).toHaveLength(0);
  });

  it('ignores non-status changelog fields', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'Test', assignee: null },
      changelog: {
        histories: [{
          created: '2026-06-12T10:00:00Z',
          items: [{ field: 'assignee', fromString: 'Alice', toString: 'Bob' }],
        }],
      },
    };
    expect(extractStatusChanges(issue, cutoffDate)).toHaveLength(0);
  });

  it('extracts multiple status changes from different history entries', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'Test', assignee: null },
      changelog: {
        histories: [
          { created: '2026-06-12T09:00:00Z', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
          { created: '2026-06-12T15:00:00Z', items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
        ],
      },
    };
    expect(extractStatusChanges(issue, cutoffDate)).toHaveLength(2);
  });
});

// ── extractCompletions ──

describe('extractCompletions', () => {
  const cutoffDate = new Date('2026-06-11T00:00:00Z');

  it('returns completion when toStatus matches a done category', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'Done thing', assignee: null, issuetype: { name: 'Story' } },
      changelog: {
        histories: [{
          created: '2026-06-12T10:00:00Z',
          items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }],
        }],
      },
    };
    const result = extractCompletions(issue, cutoffDate);
    expect(result).toHaveLength(1);
    expect(result[0].issueKey).toBe('A-1');
    expect(result[0].issueType).toBe('Story');
  });

  it('returns empty when toStatus is not a done category', () => {
    const issue = {
      key: 'A-1',
      fields: { summary: 'In flight', assignee: null, issuetype: { name: 'Story' } },
      changelog: {
        histories: [{
          created: '2026-06-12T10:00:00Z',
          items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
        }],
      },
    };
    expect(extractCompletions(issue, cutoffDate)).toHaveLength(0);
  });
});

// ── analyseIssues ──

describe('analyseIssues', () => {
  const cutoffDate = new Date('2026-06-11T00:00:00Z');

  function buildIssue(overrides) {
    return Object.assign({
      key: 'A-1',
      fields: {
        summary: 'Test issue',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Story' },
        priority: { name: 'Medium' },
        assignee: null,
        issuelinks: [],
        labels: [],
        updated: '2026-06-12T10:00:00Z',
      },
      changelog: { histories: [] },
    }, overrides);
  }

  it('classifies a Bug into the defects bucket', () => {
    const issue = buildIssue({ fields: Object.assign({}, buildIssue().fields, { issuetype: { name: 'Bug' } }) });
    const { defects } = analyseIssues([issue], cutoffDate);
    expect(defects).toHaveLength(1);
    expect(defects[0].issueKey).toBe('A-1');
  });

  it('classifies a Defect issuetype into the defects bucket', () => {
    const issue = buildIssue({ fields: Object.assign({}, buildIssue().fields, { issuetype: { name: 'Defect' } }) });
    const { defects } = analyseIssues([issue], cutoffDate);
    expect(defects).toHaveLength(1);
  });

  it('classifies an issue with risk label into the risks bucket', () => {
    const issue = buildIssue({ fields: Object.assign({}, buildIssue().fields, { labels: ['risk'] }) });
    const { risks } = analyseIssues([issue], cutoffDate);
    expect(risks).toHaveLength(1);
  });

  it('classifies a Risk issuetype into the risks bucket', () => {
    const issue = buildIssue({ fields: Object.assign({}, buildIssue().fields, { issuetype: { name: 'Risk' } }) });
    const { risks } = analyseIssues([issue], cutoffDate);
    expect(risks).toHaveLength(1);
  });

  it('classifies an issue with blocked status into the blockers bucket', () => {
    const issue = buildIssue({ fields: Object.assign({}, buildIssue().fields, { status: { name: 'Blocked' } }) });
    const { blockers } = analyseIssues([issue], cutoffDate);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].blockerType).toBe('Blocked Status');
  });

  it('classifies an issue with a blocking issuelink into the blockers bucket', () => {
    const issue = buildIssue({
      fields: Object.assign({}, buildIssue().fields, {
        issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' } }],
      }),
    });
    const { blockers } = analyseIssues([issue], cutoffDate);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].blockerType).toBe('Linked Blocker');
  });

  it('does not double-count a status-blocked issue with a blocking link', () => {
    const issue = buildIssue({
      fields: Object.assign({}, buildIssue().fields, {
        status: { name: 'Blocked' },
        issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' } }],
      }),
    });
    const { blockers } = analyseIssues([issue], cutoffDate);
    // Only one entry even though both signals fire — the linked check takes precedence
    expect(blockers).toHaveLength(1);
  });

  it('places a Bug with status changes in both defects and statusChanges buckets', () => {
    const issue = buildIssue({
      key: 'A-2',
      fields: Object.assign({}, buildIssue().fields, { issuetype: { name: 'Bug' } }),
      changelog: {
        histories: [{
          created: '2026-06-12T10:00:00Z',
          items: [{ field: 'status', fromString: 'Open', toString: 'In Progress' }],
        }],
      },
    });
    const { defects, statusChanges } = analyseIssues([issue], cutoffDate);
    expect(defects).toHaveLength(1);
    expect(statusChanges).toHaveLength(1);
  });
});

// ── calculateDaysBlocked ──

describe('calculateDaysBlocked', () => {
  it('returns 0 when the issue has no blocked status transition', () => {
    const issue = {
      fields: {},
      changelog: {
        histories: [{
          created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
        }],
      },
    };
    expect(calculateDaysBlocked(issue)).toBe(0);
  });

  it('returns a positive day count from the blocked transition', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const issue = {
      fields: {},
      changelog: {
        histories: [{
          created: threeDaysAgo,
          items: [{ field: 'status', fromString: 'In Progress', toString: 'Blocked' }],
        }],
      },
    };
    expect(calculateDaysBlocked(issue)).toBe(3);
  });

  it('returns 0 when changelog is absent', () => {
    const issue = { fields: {} };
    expect(calculateDaysBlocked(issue)).toBe(0);
  });
});

// ── extractSprintName ──

describe('extractSprintName', () => {
  it('returns "Unknown Sprint" when no issues have a sprint field', () => {
    expect(extractSprintName([{ fields: {} }])).toBe('Unknown Sprint');
    expect(extractSprintName([])).toBe('Unknown Sprint');
  });

  it('extracts name from object-form sprint field (Jira Cloud)', () => {
    const issue = { fields: { customfield_10016: [{ name: 'Sprint 24', state: 'active' }] } };
    expect(extractSprintName([issue])).toBe('Sprint 24');
  });

  it('extracts name from string-form sprint field (Jira Server)', () => {
    const sprintString = 'com.atlassian.greenhopper.service.sprint.Sprint@abc[id=1,rapidViewId=2,state=ACTIVE,name=Sprint 24,goal=...]';
    const issue = { fields: { customfield_10016: [sprintString] } };
    expect(extractSprintName([issue])).toBe('Sprint 24');
  });

  it('skips issues with no sprint field and uses the first one that has it', () => {
    const issues = [
      { fields: {} },
      { fields: { customfield_10016: [{ name: 'Sprint 25' }] } },
    ];
    expect(extractSprintName(issues)).toBe('Sprint 25');
  });
});

// ── buildBriefingMarkdown ──

describe('buildBriefingMarkdown', () => {
  const emptyBuckets = { statusChanges: [], blockers: [], defects: [], risks: [], completions: [] };

  it('contains the date banner line', () => {
    const result = buildBriefingMarkdown(emptyBuckets, 'Team Alpha', 'Sprint 24', 1);
    expect(result).toMatch(/=== PRE-STANDUP BRIEFING — \d{4}-\d{2}-\d{2} ===/);
  });

  it('includes the team name and sprint name in the header', () => {
    const result = buildBriefingMarkdown(emptyBuckets, 'Team Alpha', 'Sprint 24', 1);
    expect(result).toContain('Team: Team Alpha');
    expect(result).toContain('Sprint: Sprint 24');
  });

  it('includes all five section headers', () => {
    const result = buildBriefingMarkdown(emptyBuckets, 'Team Alpha', 'Sprint 24', 1);
    expect(result).toContain('📋 STATUS CHANGES (0)');
    expect(result).toContain('🚨 BLOCKERS (0)');
    expect(result).toContain('🐛 DEFECT ACTIVITY (0)');
    expect(result).toContain('⚠️ RISKS (0)');
    expect(result).toContain('✅ COMPLETIONS (0)');
  });

  it('shows correct counts in section headers when buckets have items', () => {
    const buckets = {
      statusChanges: [{ issueKey: 'A-1', summary: 'x', fromStatus: 'a', toStatus: 'b', assignee: 'Alice' }],
      blockers:      [],
      defects:       [{ issueKey: 'A-2', summary: 'y', priority: 'High', status: 'Open', assignee: 'Bob' }],
      risks:         [],
      completions:   [],
    };
    const result = buildBriefingMarkdown(buckets, 'Team', 'Sprint', 1);
    expect(result).toContain('📋 STATUS CHANGES (1)');
    expect(result).toContain('🐛 DEFECT ACTIVITY (1)');
    expect(result).toContain('🚨 BLOCKERS (0)');
  });

  it('shows "Last N days" period for daysBack > 1', () => {
    const result = buildBriefingMarkdown(emptyBuckets, 'T', 'S', 3);
    expect(result).toContain('Period: Last 3 days');
  });

  it('shows "Last 24 hours" for daysBack === 1', () => {
    const result = buildBriefingMarkdown(emptyBuckets, 'T', 'S', 1);
    expect(result).toContain('Period: Last 24 hours');
  });
});
