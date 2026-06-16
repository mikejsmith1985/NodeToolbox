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
} = require('./featureChangeScheduler');

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
