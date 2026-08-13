// changeAudit.test.ts — Covers how a status change is attributed. The load-bearing cases are the
// honest ones: a change must never be called hand-made on the strength of a silence the local write
// record cannot actually speak to, and a "Done"-looking bulk pattern must not be read as deliberate.

import { describe, expect, it } from 'vitest';

import {
  buildStatusChangeAuditJql,
  classifyChangeOrigin,
  extractStatusChangeEvents,
  findBurstPartners,
  hasOperatorSignature,
  resolveJournalCoverageStart,
  type JournalEntry,
  type StatusChangeEvent,
} from './changeAudit.ts';

function buildEvent(overrides: Partial<StatusChangeEvent> = {}): StatusChangeEvent {
  return {
    issueKey: 'ENFCT-2000',
    issueSummary: 'A story',
    atIso: '2026-08-13T10:00:00.000Z',
    fromStatus: 'To Do',
    toStatus: 'Cancelled',
    authorDisplayName: 'Smith, Michael (CTR)',
    companionFields: [],
    ...overrides,
  };
}

function buildJournalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    atIso: '2026-08-13T10:00:00.000Z',
    method: 'POST',
    path: '/rest/api/2/issue/ENFCT-2000/transitions',
    issueKey: 'ENFCT-2000',
    kind: 'transition',
    source: 'ui',
    ...overrides,
  };
}

describe('buildStatusChangeAuditJql', () => {
  it('asks Jira for changes this person made, not for issues merely sitting in the status', () => {
    const jql = buildStatusChangeAuditJql('Cancelled', '2026-08-01');
    expect(jql).toContain('status CHANGED TO "Cancelled"');
    expect(jql).toContain('BY currentUser()');
    expect(jql).toContain('AFTER "2026-08-01"');
  });

  it('scopes to projects when given, and omits the clause entirely when not', () => {
    expect(buildStatusChangeAuditJql('Cancelled', '2026-08-01', ['enfct', ' denp '])).toContain('project in (ENFCT, DENP)');
    expect(buildStatusChangeAuditJql('Cancelled', '2026-08-01', [])).not.toContain('project in');
  });
});

describe('hasOperatorSignature', () => {
  it('recognises the marker only as a trailing token', () => {
    expect(hasOperatorSignature('Moving this story. -ms')).toBe(true);
    expect(hasOperatorSignature('Latency was 40ms')).toBe(false);
    expect(hasOperatorSignature('-ms came up in discussion today')).toBe(false);
  });
});

describe('extractStatusChangeEvents', () => {
  it('captures the change and the other fields that moved in the same edit', () => {
    const events = extractStatusChangeEvents(
      {
        key: 'ENFCT-2000',
        fields: { summary: 'A story' },
        changelog: {
          histories: [
            {
              created: '2026-08-13T05:00:00.000Z',
              author: { displayName: 'Smith, Michael (CTR)' },
              items: [
                { field: 'Fix Version', fromString: '99/99/9999', toString: null },
                { field: 'resolution', fromString: null, toString: 'Cancelled' },
                { field: 'status', fromString: 'To Do', toString: 'Cancelled' },
                { field: 'Story Points Selection', fromString: '5', toString: null },
              ],
            },
          ],
        },
      },
      'Cancelled',
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ issueKey: 'ENFCT-2000', fromStatus: 'To Do', toStatus: 'Cancelled' });
    // The companion fields are the tell for a wide bulk edit — status itself is not repeated.
    expect(events[0].companionFields).toEqual(['Fix Version', 'resolution', 'Story Points Selection']);
  });

  it('ignores changegroups that moved a different status, and issues with no changelog', () => {
    const histories = [{ created: '2026-08-13T05:00:00.000Z', items: [{ field: 'status', fromString: 'To Do', toString: 'Working' }] }];
    expect(extractStatusChangeEvents({ key: 'A-1', changelog: { histories } }, 'Cancelled')).toEqual([]);
    expect(extractStatusChangeEvents({ key: 'A-1' }, 'Cancelled')).toEqual([]);
  });
});

describe('findBurstPartners', () => {
  it('pairs issues one person changed within seconds of each other', () => {
    const partners = findBurstPartners([
      buildEvent({ issueKey: 'A-1', atIso: '2026-08-13T10:00:00.000Z' }),
      buildEvent({ issueKey: 'A-2', atIso: '2026-08-13T10:00:03.000Z' }),
    ]);
    expect(partners[0]).toEqual(['A-2']);
    expect(partners[1]).toEqual(['A-1']);
  });

  it('does not pair changes that are minutes apart — that is a person working', () => {
    const partners = findBurstPartners([
      buildEvent({ issueKey: 'A-1', atIso: '2026-08-13T10:00:00.000Z' }),
      buildEvent({ issueKey: 'A-2', atIso: '2026-08-13T10:04:00.000Z' }),
    ]);
    expect(partners[0]).toEqual([]);
  });

  it('does not pair changes made by different people', () => {
    const partners = findBurstPartners([
      buildEvent({ issueKey: 'A-1', authorDisplayName: 'One' }),
      buildEvent({ issueKey: 'A-2', authorDisplayName: 'Two' }),
    ]);
    expect(partners[0]).toEqual([]);
  });

  it('never pairs an issue with itself across two of its own changes', () => {
    const partners = findBurstPartners([
      buildEvent({ issueKey: 'A-1', atIso: '2026-08-13T10:00:00.000Z' }),
      buildEvent({ issueKey: 'A-1', atIso: '2026-08-13T10:00:02.000Z' }),
    ]);
    expect(partners[0]).toEqual([]);
  });
});

describe('classifyChangeOrigin', () => {
  const coverageStart = '2026-08-01T00:00:00.000Z';

  it('a matching local write record is treated as proof and outranks everything else', () => {
    const { origin, evidence } = classifyChangeOrigin(
      buildEvent(),
      ['A-9'],
      [buildJournalEntry({ atIso: '2026-08-13T10:00:01.000Z' })],
      [],
      coverageStart,
    );
    expect(origin).toBe('assisted-confirmed');
    expect(evidence).toContain('ENFCT-2000');
  });

  it('a journal entry for a DIFFERENT issue does not attribute this change', () => {
    const { origin } = classifyChangeOrigin(
      buildEvent(),
      [],
      [buildJournalEntry({ issueKey: 'OTHER-1', path: '/rest/api/2/issue/OTHER-1/transitions' })],
      [],
      coverageStart,
    );
    expect(origin).toBe('hand-made');
  });

  it('a journal entry far from the change in time does not attribute it', () => {
    const { origin } = classifyChangeOrigin(
      buildEvent(),
      [],
      [buildJournalEntry({ atIso: '2026-08-13T09:00:00.000Z' })],
      [],
      coverageStart,
    );
    expect(origin).toBe('hand-made');
  });

  it('a marked comment beside the change attributes it', () => {
    const { origin } = classifyChangeOrigin(buildEvent(), [], [], ['2026-08-13T10:00:05.000Z'], coverageStart);
    expect(origin).toBe('assisted-signed');
  });

  it('several issues moved together read as a bulk operation', () => {
    const { origin, evidence } = classifyChangeOrigin(buildEvent(), ['A-2', 'A-3'], [], [], coverageStart);
    expect(origin).toBe('batch');
    expect(evidence).toContain('A-2');
  });

  it('THE HONEST CASE: silence before the record began is undetermined, never hand-made', () => {
    const { origin, evidence } = classifyChangeOrigin(
      buildEvent({ atIso: '2026-07-15T10:00:00.000Z' }),
      [],
      [buildJournalEntry()],
      [],
      coverageStart,
    );
    expect(origin).toBe('indeterminate');
    expect(evidence).toContain(coverageStart);
  });

  it('with no local record at all, nothing is called hand-made', () => {
    const { origin } = classifyChangeOrigin(buildEvent(), [], [], [], null);
    expect(origin).toBe('indeterminate');
  });

  it('only calls a change hand-made when the record covers it and found nothing', () => {
    const { origin } = classifyChangeOrigin(buildEvent(), [], [buildJournalEntry({ issueKey: 'OTHER-1' })], [], coverageStart);
    expect(origin).toBe('hand-made');
  });
});

describe('resolveJournalCoverageStart', () => {
  it('is the earliest recorded write', () => {
    expect(resolveJournalCoverageStart([
      buildJournalEntry({ atIso: '2026-08-13T10:00:00.000Z' }),
      buildJournalEntry({ atIso: '2026-08-02T10:00:00.000Z' }),
    ])).toBe('2026-08-02T10:00:00.000Z');
  });

  it('is null when nothing has been recorded, so callers must report uncertainty', () => {
    expect(resolveJournalCoverageStart([])).toBeNull();
  });
});
