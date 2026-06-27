// Unit tests for the feature change scheduler's pure helpers.
// All tested functions operate on plain data — no mocks needed.

'use strict';

const {
  getCurrentTimeHHMM,
  getTodayDateString,
  isTodayWeekend,
  getPreviousBusinessDayCutoff,
  extractFeatureChangeEntries,
  escapeXml,
  extractPageIdFromUrl,
  buildFeatureAiAssistPrompt,
  buildFeatureRollupAiAssistPrompt,
  buildAiAssistTrendPanel,
} = require('./featureChangeScheduler');

describe('buildFeatureAiAssistPrompt (US1)', () => {
  it('includes the label and all three change categories', () => {
    const prompt = buildFeatureAiAssistPrompt(
      [{ issueKey: 'F-1', issueSummary: 'Payments', fromValue: '2.0', toValue: '2.1' }],
      [{ issueKey: 'F-2', issueSummary: 'Search', fromValue: 'In Progress', toValue: 'Done' }],
      [],
      'PI-2026.2',
    );
    expect(prompt).toContain('PI-2026.2');
    expect(prompt).toContain('F-1 Payments: 2.0 → 2.1');
    expect(prompt).toContain('F-2 Search: In Progress → Done');
    expect(prompt).toContain('Schedule changes:');
    expect(prompt).toContain('(none)'); // empty schedule list
  });
});

describe('buildAiAssistTrendPanel (US1)', () => {
  it('wraps text in an info macro and escapes XML', () => {
    const html = buildAiAssistTrendPanel('PI-2026.2 slipping & risky');
    expect(html).toContain('<ac:structured-macro ac:name="info">');
    expect(html).toContain('🤖 AI Assist trend');
    expect(html).toContain('slipping &amp; risky');
  });
});

describe('buildFeatureRollupAiAssistPrompt (US1 ART rollup)', () => {
  it('summarises each team with its total feature-change count', () => {
    const prompt = buildFeatureRollupAiAssistPrompt([
      { teamName: 'Alpha', fixVersionEntries: [{}], statusEntries: [{}], scheduleEntries: [] },
      { teamName: 'Beta', fixVersionEntries: [], statusEntries: [], scheduleEntries: [] },
    ]);
    expect(prompt).toContain('cross-team ART rollup');
    expect(prompt).toContain('Alpha: 2 feature change(s)');
    expect(prompt).toContain('Beta: 0 feature change(s)');
    expect(prompt).toContain('most at risk');
  });
});

describe('time helpers', () => {
  it('getCurrentTimeHHMM returns HH:MM', () => {
    expect(getCurrentTimeHHMM()).toMatch(/^\d{2}:\d{2}$/);
  });
  it('getTodayDateString returns YYYY-MM-DD', () => {
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
    const cutoff        = getPreviousBusinessDayCutoff();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    expect(cutoff.getTime()).toBeLessThan(todayMidnight.getTime());
  });

  it('on a Monday returns a date that is a Friday (3 days prior)', () => {
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
  it('escapes XML-significant characters', () => {
    expect(escapeXml('<a> & "b"')).toBe('&lt;a&gt; &amp; &quot;b&quot;');
  });
});

describe('extractPageIdFromUrl', () => {
  it('extracts a 6+ digit page id', () => {
    expect(extractPageIdFromUrl('https://x.atlassian.net/wiki/pages/987654/Feature')).toBe('987654');
  });
  it('returns null without a page id', () => {
    expect(extractPageIdFromUrl('https://x.atlassian.net/wiki')).toBeNull();
  });
});

describe('extractFeatureChangeEntries', () => {
  const cutoffDate = new Date('2026-06-01T00:00:00.000Z');

  function buildIssue(items) {
    return {
      key: 'DENP-100',
      fields: { summary: 'A feature', issuetype: { name: 'Feature' } },
      changelog: {
        histories: [
          { created: '2026-06-10T09:00:00.000Z', author: { displayName: 'Pat Lee' }, items },
        ],
      },
    };
  }

  it('buckets fix version, status, and due date changes', () => {
    const issues = [buildIssue([
      { field: 'Fix Version', fromString: '25.1', toString: '25.2' },
      { field: 'status', fromString: 'To Do', toString: 'In Progress' },
      { field: 'Due Date', fromString: null, toString: '2026-07-01' },
    ])];

    const { fixVersionEntries, statusEntries, scheduleEntries } = extractFeatureChangeEntries(issues, cutoffDate);

    expect(fixVersionEntries).toHaveLength(1);
    expect(fixVersionEntries[0].fieldLabel).toBe('Fix Version');
    expect(statusEntries).toHaveLength(1);
    expect(statusEntries[0].toValue).toBe('In Progress');
    expect(scheduleEntries).toHaveLength(1);
    expect(scheduleEntries[0].fieldLabel).toBe('Due Date');
  });

  it('collapses a remove-then-re-add into one net change instead of an empty previous value', () => {
    // After the coverage-watermark rework a field can change several times inside one self-healed
    // window. The report must report the net change with the real prior value, not a blank left by
    // the intermediate removal.
    const issues = [{
      key: 'DENP-9',
      fields: { summary: 'Bounced feature', issuetype: { name: 'Feature' } },
      changelog: { histories: [
        { created: '2026-06-20T09:00:00.000Z', author: { displayName: 'Pat Lee' }, items: [{ field: 'Fix Version', fromString: '25.1', toString: '' }] },
        { created: '2026-06-24T09:00:00.000Z', author: { displayName: 'Pat Lee' }, items: [{ field: 'Fix Version', fromString: '', toString: '25.3' }] },
      ] },
    }];
    const { fixVersionEntries } = extractFeatureChangeEntries(issues, cutoffDate);
    expect(fixVersionEntries).toHaveLength(1);
    expect(fixVersionEntries[0].fromValue).toBe('25.1');
    expect(fixVersionEntries[0].toValue).toBe('25.3');
  });

  it('skips changes before the cutoff date', () => {
    const oldIssue = {
      key: 'DENP-101',
      fields: { summary: 'Old', issuetype: { name: 'Feature' } },
      changelog: { histories: [
        { created: '2026-05-01T09:00:00.000Z', author: { displayName: 'Pat Lee' }, items: [{ field: 'status', fromString: 'a', toString: 'b' }] },
      ] },
    };
    const result = extractFeatureChangeEntries([oldIssue], cutoffDate);
    expect(result.fixVersionEntries).toHaveLength(0);
    expect(result.statusEntries).toHaveLength(0);
    expect(result.scheduleEntries).toHaveLength(0);
  });

  it('defaults missing from/to values to an em dash', () => {
    const issues = [buildIssue([{ field: 'status', toString: undefined }])];
    const { statusEntries } = extractFeatureChangeEntries(issues, cutoffDate);
    expect(statusEntries[0].fromValue).toBe('—');
    expect(statusEntries[0].toValue).toBe('—');
  });
});
