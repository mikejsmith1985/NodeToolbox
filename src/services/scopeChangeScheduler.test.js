// Unit tests for the scope change scheduler's pure helpers.
// All tested functions operate on plain data — no mocks needed.

'use strict';

const {
  getCurrentTimeHHMM,
  getTodayDateString,
  isTodayWeekend,
  getPreviousBusinessDayCutoff,
  extractChangeEntries,
  escapeXml,
  renderChangeTable,
  extractPageIdFromUrl,
} = require('./scopeChangeScheduler');

describe('getCurrentTimeHHMM', () => {
  it('returns a zero-padded HH:MM string', () => {
    expect(getCurrentTimeHHMM()).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('getTodayDateString', () => {
  it('returns a zero-padded YYYY-MM-DD string', () => {
    expect(getTodayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isTodayWeekend', () => {
  it('returns a boolean', () => {
    expect(typeof isTodayWeekend()).toBe('boolean');
  });
});

describe('getPreviousBusinessDayCutoff', () => {
  it('returns a Date at midnight (00:00:00.000)', () => {
    const cutoff = getPreviousBusinessDayCutoff();
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getHours()).toBe(0);
    expect(cutoff.getMinutes()).toBe(0);
    expect(cutoff.getSeconds()).toBe(0);
    expect(cutoff.getMilliseconds()).toBe(0);
  });

  it('returns a date strictly before today', () => {
    const cutoff   = getPreviousBusinessDayCutoff();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    expect(cutoff.getTime()).toBeLessThan(todayMidnight.getTime());
  });

  it('on a Monday returns a date that is a Friday (3 days prior)', () => {
    // Freeze "today" to a known Monday: 2026-06-15
    const originalDate = global.Date;
    const mondayMs = new originalDate('2026-06-15T09:00:00').getTime();
    global.Date = class extends originalDate {
      constructor(...args) { return args.length ? new originalDate(...args) : new originalDate(mondayMs); }
      static now() { return mondayMs; }
    };

    const cutoff = getPreviousBusinessDayCutoff();
    expect(cutoff.getDay()).toBe(5); // 5 = Friday

    global.Date = originalDate;
  });

  it('on a Wednesday returns a date that is a Tuesday (1 day prior)', () => {
    const originalDate = global.Date;
    const wednesdayMs = new originalDate('2026-06-17T09:00:00').getTime();
    global.Date = class extends originalDate {
      constructor(...args) { return args.length ? new originalDate(...args) : new originalDate(wednesdayMs); }
      static now() { return wednesdayMs; }
    };

    const cutoff = getPreviousBusinessDayCutoff();
    expect(cutoff.getDay()).toBe(2); // 2 = Tuesday

    global.Date = originalDate;
  });
});

describe('escapeXml', () => {
  it('escapes ampersands, angle brackets, and quotes', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('coerces non-strings to string', () => {
    expect(escapeXml(42)).toBe('42');
  });
});

describe('extractPageIdFromUrl', () => {
  it('extracts a 6+ digit page id from a Confluence URL', () => {
    expect(extractPageIdFromUrl('https://x.atlassian.net/wiki/spaces/AB/pages/123456/Title')).toBe('123456');
  });

  it('returns null when there is no page id', () => {
    expect(extractPageIdFromUrl('https://x.atlassian.net/wiki/spaces/AB')).toBeNull();
  });
});

describe('extractChangeEntries', () => {
  const cutoffDate = new Date('2026-06-01T00:00:00.000Z');

  function buildIssue(histories) {
    return {
      key: 'DENP-1',
      fields: { summary: 'Demo issue', issuetype: { name: 'Story' } },
      changelog: { histories },
    };
  }

  it('extracts entries for the target field after the cutoff', () => {
    const issues = [
      buildIssue([
        {
          created: '2026-06-10T10:00:00.000Z',
          author: { displayName: 'Jane Smith' },
          items: [{ field: 'Fix Version', fromString: '25.1', toString: '25.2' }],
        },
      ]),
    ];
    const entries = extractChangeEntries(issues, 'fix version', 'fixVersion', cutoffDate);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      issueKey: 'DENP-1',
      changeType: 'fixVersion',
      fromValue: '25.1',
      toValue: '25.2',
      changedBy: 'Jane Smith',
    });
  });

  it('skips histories before the cutoff date', () => {
    const issues = [
      buildIssue([
        {
          created: '2026-05-01T10:00:00.000Z',
          author: { displayName: 'Old Author' },
          items: [{ field: 'Fix Version', fromString: 'a', toString: 'b' }],
        },
      ]),
    ];
    expect(extractChangeEntries(issues, 'fix version', 'fixVersion', cutoffDate)).toHaveLength(0);
  });

  it('ignores items for other fields and items without a toString', () => {
    const issues = [
      buildIssue([
        {
          created: '2026-06-10T10:00:00.000Z',
          author: { displayName: 'Jane Smith' },
          items: [
            { field: 'Status', fromString: 'To Do', toString: 'Done' },
            { field: 'Fix Version', fromString: 'x', toString: '' },
          ],
        },
      ]),
    ];
    expect(extractChangeEntries(issues, 'fix version', 'fixVersion', cutoffDate)).toHaveLength(0);
  });

  it('defaults fromValue to an em dash when absent', () => {
    const issues = [
      buildIssue([
        {
          created: '2026-06-10T10:00:00.000Z',
          author: { displayName: 'Jane Smith' },
          items: [{ field: 'Fix Version', toString: '25.2' }],
        },
      ]),
    ];
    expect(extractChangeEntries(issues, 'fix version', 'fixVersion', cutoffDate)[0].fromValue).toBe('—');
  });
});

describe('renderChangeTable', () => {
  it('renders an italic empty-state paragraph when there are no entries', () => {
    expect(renderChangeTable([], 'Nothing changed.')).toBe('<p><em>Nothing changed.</em></p>');
  });

  it('renders a header row when there are entries', () => {
    const entries = [{
      issueKey: 'DENP-1', issueSummary: 'Demo', issueType: 'Story',
      fromValue: '25.1', toValue: '25.2', changedBy: 'Jane', changedAt: '2026-06-10',
    }];
    const table = renderChangeTable(entries, 'empty');
    expect(table).toContain('<th><strong>Issue</strong></th>');
    expect(table).toContain('DENP-1');
  });
});
