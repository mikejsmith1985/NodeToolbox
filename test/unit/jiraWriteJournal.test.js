// jiraWriteJournal.test.js — Confirms the local write record captures the facts needed to attribute
// a Jira change later: that it recorded writes but not reads, which issue was touched, what kind of
// write it was, and that it never carries request bodies or breaks the caller when the disk refuses.

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const journalPath = path.join(os.tmpdir(), 'tbx-test-jira-write-journal-' + process.pid + '.json');
process.env.TBX_JIRA_WRITE_JOURNAL_PATH = journalPath;

const jiraWriteJournal = require('../../src/services/jiraWriteJournal');

function removeJournalFile() {
  try { fs.unlinkSync(journalPath); } catch (_ignored) { /* absent is fine */ }
}

beforeEach(removeJournalFile);
afterAll(removeJournalFile);

describe('isJiraWrite', () => {
  test.each(['POST', 'PUT', 'DELETE', 'PATCH', 'post'])('treats %s as a write', (httpMethod) => {
    expect(jiraWriteJournal.isJiraWrite(httpMethod, '/rest/api/2/issue/ABC-1')).toBe(true);
  });

  test('ignores reads — a journal full of searches would bury the writes', () => {
    expect(jiraWriteJournal.isJiraWrite('GET', '/rest/api/2/search?jql=x')).toBe(false);
    expect(jiraWriteJournal.isJiraWrite('HEAD', '/rest/api/2/issue/ABC-1')).toBe(false);
  });
});

describe('extractIssueKeyFromPath', () => {
  test('reads the issue key from an issue-scoped path', () => {
    expect(jiraWriteJournal.extractIssueKeyFromPath('/rest/api/2/issue/ENFCT-2000/transitions')).toBe('ENFCT-2000');
  });

  test('upper-cases a lower-cased key so lookups match', () => {
    expect(jiraWriteJournal.extractIssueKeyFromPath('/rest/api/2/issue/enfct-2000')).toBe('ENFCT-2000');
  });

  test('returns null when the write does not target one issue', () => {
    expect(jiraWriteJournal.extractIssueKeyFromPath('/rest/api/2/issue')).toBeNull();
    expect(jiraWriteJournal.extractIssueKeyFromPath('/rest/agile/1.0/sprint/42/issue')).toBeNull();
  });

  test('does not mistake an issue key inside a JQL query for the write target', () => {
    expect(jiraWriteJournal.extractIssueKeyFromPath('/rest/api/2/search?jql=key=ABC-9')).toBeNull();
  });
});

describe('classifyWriteKind', () => {
  test.each([
    ['/rest/api/2/issue/ABC-1/transitions', 'transition'],
    ['/rest/api/2/issue/ABC-1/comment', 'comment'],
    ['/rest/api/2/issue/ABC-1/worklog', 'worklog'],
    ['/rest/api/2/issueLink', 'link'],
    ['/rest/api/2/issue/ABC-1', 'field'],
  ])('classifies %s as %s', (requestPath, expectedKind) => {
    expect(jiraWriteJournal.classifyWriteKind(requestPath)).toBe(expectedKind);
  });
});

describe('buildJournalEntry', () => {
  test('captures the routing facts and drops the query string', () => {
    const entry = jiraWriteJournal.buildJournalEntry({
      method: 'post',
      path: '/rest/api/2/issue/ABC-1/transitions?notifyUsers=false',
      source: 'ui',
      atIso: '2026-08-13T10:00:00.000Z',
    });

    expect(entry).toEqual({
      atIso: '2026-08-13T10:00:00.000Z',
      method: 'POST',
      path: '/rest/api/2/issue/ABC-1/transitions',
      issueKey: 'ABC-1',
      kind: 'transition',
      source: 'ui',
      statusCode: null,
    });
  });

  test('never carries a request body — attribution must not duplicate issue content', () => {
    const entry = jiraWriteJournal.buildJournalEntry({
      method: 'PUT',
      path: '/rest/api/2/issue/ABC-1',
      source: 'ui',
      body: { fields: { summary: 'confidential' } },
    });
    expect(Object.keys(entry)).not.toContain('body');
    expect(JSON.stringify(entry)).not.toContain('confidential');
  });
});

describe('recordJiraWrite and queryJournal', () => {
  test('persists writes newest-first and ignores reads', () => {
    jiraWriteJournal.recordJiraWrite({ method: 'POST', path: '/rest/api/2/issue/ABC-1/comment', source: 'ui', atIso: '2026-08-13T10:00:00.000Z' });
    jiraWriteJournal.recordJiraWrite({ method: 'GET',  path: '/rest/api/2/issue/ABC-2', source: 'ui', atIso: '2026-08-13T11:00:00.000Z' });
    jiraWriteJournal.recordJiraWrite({ method: 'POST', path: '/rest/api/2/issue/ABC-2/transitions', source: 'github-intake', atIso: '2026-08-13T12:00:00.000Z' });

    const entries = jiraWriteJournal.queryJournal();
    expect(entries).toHaveLength(2);
    expect(entries[0].issueKey).toBe('ABC-2');
    expect(entries[0].kind).toBe('transition');
    expect(entries[1].issueKey).toBe('ABC-1');
  });

  test('narrows by issue key and by start time', () => {
    jiraWriteJournal.recordJiraWrite({ method: 'POST', path: '/rest/api/2/issue/ABC-1/comment', source: 'ui', atIso: '2026-08-01T10:00:00.000Z' });
    jiraWriteJournal.recordJiraWrite({ method: 'POST', path: '/rest/api/2/issue/ABC-2/comment', source: 'ui', atIso: '2026-08-10T10:00:00.000Z' });

    expect(jiraWriteJournal.queryJournal({ issueKey: 'abc-1' })).toHaveLength(1);
    expect(jiraWriteJournal.queryJournal({ sinceIso: '2026-08-05T00:00:00.000Z' })).toHaveLength(1);
    expect(jiraWriteJournal.queryJournal({ sinceIso: '2026-08-05T00:00:00.000Z' })[0].issueKey).toBe('ABC-2');
  });

  test('a missing journal file reads as empty rather than throwing', () => {
    expect(jiraWriteJournal.queryJournal()).toEqual([]);
  });

  test('a corrupt journal file reads as empty rather than throwing', () => {
    fs.writeFileSync(journalPath, 'not json at all', 'utf8');
    expect(jiraWriteJournal.readJournal()).toEqual([]);
  });

  test('a failing disk never propagates into the caller — journalling must not break a Jira write', () => {
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('disk full'); });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => jiraWriteJournal.recordJiraWrite({ method: 'POST', path: '/rest/api/2/issue/ABC-1/comment', source: 'ui' })).not.toThrow();

    writeSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('trims to the entry cap so the file cannot grow without bound', () => {
    const overCap = jiraWriteJournal.MAX_JOURNAL_ENTRIES + 5;
    const seededEntries = Array.from({ length: overCap }, (_unused, index) => ({
      atIso: '2026-08-13T10:00:00.000Z', method: 'POST', path: '/rest/api/2/issue/ABC-' + index + '/comment',
      issueKey: 'ABC-' + index, kind: 'comment', source: 'ui', statusCode: null,
    }));
    fs.writeFileSync(journalPath, JSON.stringify(seededEntries), 'utf8');

    jiraWriteJournal.recordJiraWrite({ method: 'POST', path: '/rest/api/2/issue/NEW-1/comment', source: 'ui' });

    const entries = jiraWriteJournal.readJournal();
    expect(entries).toHaveLength(jiraWriteJournal.MAX_JOURNAL_ENTRIES);
    expect(entries[0].issueKey).toBe('NEW-1');
  });
});
