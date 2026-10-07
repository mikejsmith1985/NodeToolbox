// epicDatePlanInputs.test.ts — Reading the Epics to plan out of the PI Review table and its Jira data.

import { describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import { readPiReviewTargetDates } from '../piReviewJira.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from '../piReviewTable.ts';
import { buildEpicsToSchedule, readPointEstimate } from './epicDatePlanInputs.ts';

vi.mock('../piReviewJira.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../piReviewJira.ts')>()),
  readPiReviewTargetDates: vi.fn(),
}));

function buildRow(feature: string, pointEstimate: string): PiReviewRow {
  return { ...createEmptyPiReviewRow(), feature, pointEstimate };
}

function buildIssue(key: string, statusCategoryKey: string): JiraIssue {
  return { key, fields: { summary: `${key} from Jira`, status: { name: 'S', statusCategory: { key: statusCategoryKey } } } } as unknown as JiraIssue;
}

describe('readPointEstimate', () => {
  it('reads a positive number and treats anything else as no estimate', () => {
    expect(readPointEstimate(' 13 ')).toBe(13);
    expect(readPointEstimate('')).toBeNull();
    expect(readPointEstimate('0')).toBeNull();
    expect(readPointEstimate('TBD')).toBeNull();
  });
});

describe('buildEpicsToSchedule', () => {
  it('keeps page order, reads points, Jira summary, whether work has started, and the current Target Start', () => {
    vi.mocked(readPiReviewTargetDates).mockImplementation((jiraIssue) => ({
      targetStart: jiraIssue?.key === 'DENP-2' ? '2026-09-21' : null,
      targetEnd: null,
    }));
    const rows = [buildRow('DENP-1 - First', '20'), buildRow('no key here', '5'), buildRow('DENP-2', ''), buildRow('DENP-1 again', '8')];
    const jiraIssueMap = { 'DENP-1': buildIssue('DENP-1', 'new'), 'DENP-2': buildIssue('DENP-2', 'indeterminate') };

    expect(buildEpicsToSchedule(rows, jiraIssueMap)).toEqual([
      { epicKey: 'DENP-1', summary: 'DENP-1 from Jira', points: 20, isStarted: false, existingTargetStart: null },
      { epicKey: 'DENP-2', summary: 'DENP-2 from Jira', points: null, isStarted: true, existingTargetStart: '2026-09-21' },
    ]);
  });

  it('treats an Epic Jira could not return as not started, named from the page', () => {
    vi.mocked(readPiReviewTargetDates).mockReturnValue({ targetStart: null, targetEnd: null });

    expect(buildEpicsToSchedule([buildRow('DENP-7 - Recon', '3')], {})).toEqual([
      { epicKey: 'DENP-7', summary: 'DENP-7 - Recon', points: 3, isStarted: false, existingTargetStart: null },
    ]);
  });
});
