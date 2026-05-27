// piReviewJira.test.ts — Unit tests for Jira-backed PI Review reconciliation helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraIssue } from '../../types/jira.ts';

const { mockJiraGet, mockJiraPut } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPut: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPut: mockJiraPut,
}));

import {
  extractPiReviewFeatureKey,
  fetchPiReviewFeatureIssues,
  formatPiReviewFeatureDisplayValue,
  parsePiReviewFeatureDateUpdates,
  readPiReviewFeatureDatePills,
  reconcilePiReviewRowsWithJira,
  savePiReviewFeatureDates,
  savePiReviewFeatureEstimates,
} from './piReviewJira.ts';
import { createEmptyPiReviewRow } from './piReviewTable.ts';

describe('piReviewJira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('extracts a feature key from feature cells that already include summary text', () => {
    expect(extractPiReviewFeatureKey('denp-1352 - 26.3 Enrollment Support')).toBe('DENP-1352');
  });

  it('formats the read-only feature display with the live Jira summary', () => {
    expect(formatPiReviewFeatureDisplayValue('DENP-1352', {
      id: '10001',
      key: 'DENP-1352',
      fields: {
        summary: '26.3 Enrollment Support',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: null,
        assignee: null,
        reporter: null,
        issuetype: { name: 'Feature', iconUrl: '' },
        created: '',
        updated: '',
        description: null,
      },
    })).toBe('DENP-1352 - 26.3 Enrollment Support');
  });

  it('reads configured target-date pills plus Jira due date for the feature cell', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      piReviewTargetStartFieldId: 'customfield_12345',
      piReviewTargetEndFieldId: 'customfield_12346',
    }));

    const jiraIssue = {
      id: '10001',
      key: 'DENP-1352',
      fields: {
        summary: '26.3 Enrollment Support',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: null,
        assignee: null,
        reporter: null,
        issuetype: { name: 'Feature', iconUrl: '' },
        created: '',
        updated: '',
        duedate: '2026-06-12',
        description: null,
        customfield_12345: '2026-05-30',
        customfield_12346: '2026-06-10T00:00:00.000Z',
        fixVersions: [
          { id: '301', name: '26.3' },
          { id: '302', name: '26.4' },
        ],
      },
    } as unknown as JiraIssue;

    expect(readPiReviewFeatureDatePills(jiraIssue)).toEqual([
      { label: 'Target Start', value: '2026-05-30' },
      { label: 'Target End', value: '2026-06-10' },
      { label: 'Due Date', value: '2026-06-12' },
      { label: 'Fix Version', value: '26.3' },
    ]);
  });

  it('reads the default target-date field IDs when ART settings are blank', () => {
    const jiraIssue = {
      id: '10001',
      key: 'DENP-1352',
      fields: {
        summary: '26.3 Enrollment Support',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: null,
        assignee: null,
        reporter: null,
        issuetype: { name: 'Feature', iconUrl: '' },
        created: '',
        updated: '',
        duedate: '2026-06-12',
        description: null,
        customfield_10101: '2026-05-30',
        customfield_10102: '2026-06-10T00:00:00.000Z',
      },
    } as unknown as JiraIssue;

    expect(readPiReviewFeatureDatePills(jiraIssue)).toEqual([
      { label: 'Target Start', value: '2026-05-30' },
      { label: 'Target End', value: '2026-06-10' },
      { label: 'Due Date', value: '2026-06-12' },
    ]);
  });

  it('parses pasted markdown date tables into normalized Jira updates', () => {
    expect(parsePiReviewFeatureDateUpdates(`
| Jira Key | Target Start | Target End | Due Date |
| -- | -- | -- | -- |
| DASP-966 | 5/21/2026 | 6/3/2026 | 6/25/2026 |
| DASP-824 | 2026-05-21 | 2026-06-03 | 2026-06-25 |
    `)).toEqual([
      {
        featureKey: 'DASP-966',
        targetStart: '2026-05-21',
        targetEnd: '2026-06-03',
        dueDate: '2026-06-25',
      },
      {
        featureKey: 'DASP-824',
        targetStart: '2026-05-21',
        targetEnd: '2026-06-03',
        dueDate: '2026-06-25',
      },
    ]);
  });

  it('parses pasted tab-separated date tables and keeps the last update for duplicate Jira keys', () => {
    expect(parsePiReviewFeatureDateUpdates([
      'Jira Key\tTarget Start\tTarget End\tDue Date',
      'DASP-966\t5/21/2026\t6/3/2026\t6/25/2026',
      'DASP-966\t6/4/2026\t6/17/2026\t7/30/2026',
    ].join('\n'))).toEqual([
      {
        featureKey: 'DASP-966',
        targetStart: '2026-06-04',
        targetEnd: '2026-06-17',
        dueDate: '2026-07-30',
      },
    ]);
  });

  it('rejects pasted date rows with unsupported date formats', () => {
    expect(() => parsePiReviewFeatureDateUpdates(`
| Jira Key | Target Start | Target End | Due Date |
| -- | -- | -- | -- |
| DASP-966 | May 21 2026 | 6/3/2026 | 6/25/2026 |
    `)).toThrow('Row 2: Target Start must use M/D/YYYY or YYYY-MM-DD.');
  });

  it('reconciles priority, estimate, dependencies, risks, and migrated notes from Jira', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      depLinkTypes: ['blocks', 'depends on'],
    }));
    const piReviewRow = {
      ...createEmptyPiReviewRow(),
      feature: 'DENP-1352',
      priority: 'P3',
      pointEstimate: '5',
      dependency: 'Legacy dependency note',
      risks: 'Legacy risk note',
      notes: 'Existing note',
    };

    const reconciliationResult = reconcilePiReviewRowsWithJira([piReviewRow], {
      'DENP-1352': {
        id: '10001',
        key: 'DENP-1352',
        fields: {
          summary: '26.3 Enrollment Support',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          priority: { name: 'Highest', iconUrl: '' },
          assignee: null,
          reporter: null,
          issuetype: { name: 'Feature', iconUrl: '' },
          created: '',
          updated: '',
          description: null,
          customfield_10111: 13,
          issuelinks: [
            {
              type: { outward: 'depends on' },
              outwardIssue: {
                key: 'PLAT-5',
                fields: { summary: 'Platform work', status: { name: 'In Progress' } },
              },
            },
            {
              type: { outward: 'blocks' },
              outwardIssue: {
                key: 'RISK-2',
                fields: { summary: 'Risk item', status: { name: 'Blocked' }, labels: ['impediment'] },
              },
            },
          ],
        },
      },
    });

    expect(reconciliationResult.hasChanges).toBe(true);
    expect(reconciliationResult.rows[0].priority).toBe('Highest');
    expect(reconciliationResult.rows[0].pointEstimate).toBe('13');
    expect(reconciliationResult.rows[0].dependency).toContain('PLAT-5 - Platform work');
    expect(reconciliationResult.rows[0].risks).toContain('RISK-2 - Risk item');
    expect(reconciliationResult.rows[0].notes).toContain('Dependency note: Legacy dependency note');
    expect(reconciliationResult.rows[0].notes).toContain('Risk note: Legacy risk note');
  });

  it('queues Jira estimate updates only when Jira is blank and PI Review already has a numeric value', () => {
    const piReviewRow = {
      ...createEmptyPiReviewRow(),
      feature: 'DENP-1352',
      pointEstimate: '8',
    };

    const reconciliationResult = reconcilePiReviewRowsWithJira([piReviewRow], {
      'DENP-1352': {
        id: '10001',
        key: 'DENP-1352',
        fields: {
          summary: '26.3 Enrollment Support',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          priority: null,
          assignee: null,
          reporter: null,
          issuetype: { name: 'Feature', iconUrl: '' },
          created: '',
          updated: '',
          description: null,
          customfield_10111: null,
        },
      },
    }, {
      shouldQueueEstimateUpdates: true,
    });

    expect(reconciliationResult.pendingEstimateUpdates).toEqual([
      { featureKey: 'DENP-1352', estimate: 8 },
    ]);
  });

  it('fetches feature issues in Jira search batches and indexes them by key', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        {
          id: '10001',
          key: 'DENP-1352',
          fields: {
            summary: '26.3 Enrollment Support',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            priority: null,
            assignee: null,
            reporter: null,
            issuetype: { name: 'Feature', iconUrl: '' },
            created: '',
            updated: '',
            description: null,
          },
        },
      ],
    });

    const issueMap = await fetchPiReviewFeatureIssues([
      { ...createEmptyPiReviewRow(), feature: 'DENP-1352 - 26.3 Enrollment Support' },
    ]);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    expect(mockJiraGet.mock.calls[0][0]).toContain('duedate');
    expect(mockJiraGet.mock.calls[0][0]).toContain('fixVersions');
    expect(mockJiraGet.mock.calls[0][0]).toContain('customfield_10101');
    expect(mockJiraGet.mock.calls[0][0]).toContain('customfield_10102');
    expect(issueMap['DENP-1352'].fields.summary).toBe('26.3 Enrollment Support');
  });

  it('writes queued PI Review feature estimates back to Jira', async () => {
    mockJiraPut.mockResolvedValue(undefined);

    await savePiReviewFeatureEstimates([
      { featureKey: 'DENP-1352', estimate: 8 },
      { featureKey: 'DENP-1352', estimate: 8 },
    ]);

    expect(mockJiraPut).toHaveBeenCalledTimes(1);
    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1352', {
      fields: {
        customfield_10111: 8,
      },
    });
  });

  it('writes pasted PI Review target dates back to Jira using the configured field IDs', async () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      piReviewTargetStartFieldId: 'customfield_12345',
      piReviewTargetEndFieldId: 'customfield_12346',
    }));
    mockJiraPut.mockResolvedValue(undefined);

    await savePiReviewFeatureDates([
      {
        featureKey: 'DASP-966',
        targetStart: '2026-05-21',
        targetEnd: '2026-06-03',
        dueDate: '2026-06-25',
      },
      {
        featureKey: 'DASP-966',
        targetStart: '2026-06-04',
        targetEnd: '2026-06-17',
        dueDate: '2026-07-30',
      },
    ]);

    expect(mockJiraPut).toHaveBeenCalledTimes(1);
    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DASP-966', {
      fields: {
        customfield_12345: '2026-06-04',
        customfield_12346: '2026-06-17',
        duedate: '2026-07-30',
      },
    });
  });
});
