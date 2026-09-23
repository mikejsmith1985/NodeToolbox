// batchReadinessFetch.test.ts — A twenty-Epic review has to cost two requests, not two per Epic, and it has to
// say when the query matched more than it reviewed.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));

import { jiraGet } from '../../../services/jiraApi.ts';
import { fetchChildLinesByParent, fetchEpicsForReview, MAX_EPICS_PER_REVIEW } from './batchReadinessFetch.ts';

const CHECKLIST_FIELD_ID = 'customfield_22222';

/** Two Epics, the second carrying its checklist in a field other than the named one. */
function installSearchResults(options: { total?: number } = {}): void {
  const { total = 2 } = options;

  vi.mocked(jiraGet).mockImplementation((path: string) => {
    if (path.includes('parent+in') || path.includes('parent%20in')) {
      return Promise.resolve({
        issues: [
          { key: 'DENP-9', fields: { summary: 'Build intake', status: { name: 'Done' }, parent: { key: 'DENP-1' } } },
          { key: 'DENP-10', fields: { summary: 'Orphan', status: { name: 'To Do' } } },
        ],
      }) as never;
    }
    return Promise.resolve({
      total,
      issues: [
        {
          key: 'DENP-1',
          fields: {
            summary: 'First Epic',
            status: { name: 'In Progress' },
            description: 'Signed off in August.',
            customfield_ac: 'Given a member enrols…',
            [CHECKLIST_FIELD_ID]: '- [ ] Major dependencies are identified',
          },
        },
        {
          key: 'DENP-2',
          fields: {
            summary: 'Second Epic',
            status: { name: 'To Do' },
            description: '',
            [CHECKLIST_FIELD_ID]: '',
            customfield_99999: '# DoR\n- [x] Scope is understood',
          },
        },
      ],
    }) as never;
  });
}

describe('fetchEpicsForReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the query once and loads every Epic it returned', async () => {
    installSearchResults();

    const result = await fetchEpicsForReview('project = DENP', CHECKLIST_FIELD_ID, 'customfield_ac');

    expect(result.epics.map((epic) => epic.source.issueKey)).toEqual(['DENP-1', 'DENP-2']);
    expect(result.epics[0].source.acceptanceCriteria).toBe('Given a member enrols…');
    expect(vi.mocked(jiraGet).mock.calls[0][0]).toContain(`maxResults=${MAX_EPICS_PER_REVIEW}`);
    expect(vi.mocked(jiraGet).mock.calls[0][0]).toContain('fields=*all');
  });

  it('costs two requests for a whole batch, not two per Epic', async () => {
    installSearchResults();

    await fetchEpicsForReview('project = DENP', CHECKLIST_FIELD_ID, null);

    expect(jiraGet).toHaveBeenCalledTimes(2);
  });

  it('finds each Epic’s checklist wherever it actually lives', async () => {
    installSearchResults();

    const result = await fetchEpicsForReview('project = DENP', CHECKLIST_FIELD_ID, null);

    expect(result.checklistFieldIdByIssueKey['DENP-1']).toBe(CHECKLIST_FIELD_ID);
    expect(result.checklistFieldIdByIssueKey['DENP-2']).toBe('customfield_99999');
    expect(result.epics[1].source.checklistText).toContain('Scope is understood');
  });

  it('attaches each child to its own parent', async () => {
    installSearchResults();

    const result = await fetchEpicsForReview('project = DENP', CHECKLIST_FIELD_ID, null);

    expect(result.epics[0].childSummaryLines).toEqual(['  DENP-9 — Done — Build intake']);
    expect(result.epics[1].childSummaryLines).toEqual([]);
  });

  it('says when the query matched more Epics than one review covers', async () => {
    installSearchResults({ total: 57 });

    const result = await fetchEpicsForReview('project = DENP', CHECKLIST_FIELD_ID, null);

    expect(result.totalMatching).toBe(57);
    expect(result.wasTruncated).toBe(true);
  });
});

describe('fetchChildLinesByParent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for nothing when there are no Epics', async () => {
    await expect(fetchChildLinesByParent([])).resolves.toEqual({});
    expect(jiraGet).not.toHaveBeenCalled();
  });

  it('costs the review its delivery evidence, not the whole run, when the query is refused', async () => {
    vi.mocked(jiraGet).mockRejectedValueOnce(new Error('400 — parent is not supported'));

    await expect(fetchChildLinesByParent(['DENP-1'])).resolves.toEqual({});
  });
});
