// changeProblems.test.ts — Finding the PRBs a change's Jira issues mention, and linking them to the change.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import {
  collectPrbMentions,
  fetchProblemsByNumber,
  findPrbNumbers,
  linkProblemsToNewChange,
  linkProblemToChange,
  scanIssuesForProblems,
} from './changeProblems.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

// The ServiceNow reference field, as the field mapping names it (any id works here).
const SNOW_REFERENCE_FIELD_ID = 'snow_reference_field';

/** A problem record as the Table API returns it with display values. */
function buildProblemRecord(number: string, linkedChange: { value: string; display_value: string } | '' = '') {
  return {
    sys_id: { value: `sys-${number}`, display_value: `sys-${number}` },
    number: { value: number, display_value: number },
    short_description: { value: 'Enrollment file rejected', display_value: 'Enrollment file rejected' },
    state: { value: '102', display_value: 'Fix in Progress' },
    rfc: linkedChange,
  };
}

describe('findPrbNumbers', () => {
  it('finds each PRB number once, in any case', () => {
    expect(findPrbNumbers('Fixes prb0012345 and PRB0012345; see PRB0099999. Not PRB12.')).toEqual(['PRB0012345', 'PRB0099999']);
  });
});

describe('collectPrbMentions', () => {
  it('reads the summary, the description, the comments and the ServiceNow reference field', () => {
    const issues = [
      { key: 'ENCUC-1', fields: { summary: '[SL] INC0001: PRB0000001: "file rejected"', description: 'Also PRB0000002.' } },
      { key: 'ENCUC-2', fields: { summary: 'Mapping fix', comment: { comments: [{ body: 'Root cause tracked in PRB0000002' }] } } },
      { key: 'ENCUC-3', fields: { summary: 'Crosswalk', [SNOW_REFERENCE_FIELD_ID]: 'PRB0000003' } },
      { key: 'ENCUC-4', fields: { summary: 'No problem here' } },
    ];

    expect(collectPrbMentions(issues, [SNOW_REFERENCE_FIELD_ID])).toEqual([
      { prbNumber: 'PRB0000001', issueKeys: ['ENCUC-1'] },
      { prbNumber: 'PRB0000002', issueKeys: ['ENCUC-1', 'ENCUC-2'] },
      { prbNumber: 'PRB0000003', issueKeys: ['ENCUC-3'] },
    ]);
  });
});

describe('ServiceNow problems', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
    vi.mocked(jiraGet).mockReset();
  });

  it('reads the problems by number, with the change each is linked to', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [buildProblemRecord('PRB0000001', { value: 'chg-9', display_value: 'CHG0009999' })] });

    const problems = await fetchProblemsByNumber(['PRB0000001', 'PRB0000002']);

    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('sysparm_query=numberIN' + encodeURIComponent('PRB0000001,PRB0000002'));
    expect(problems).toEqual([{
      sysId: 'sys-PRB0000001', number: 'PRB0000001', shortDescription: 'Enrollment file rejected',
      stateLabel: 'Fix in Progress', linkedChange: { sysId: 'chg-9', displayName: 'CHG0009999' },
    }]);
  });

  it('links a problem to the change through its Change request field', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: {} });

    await linkProblemToChange('sys-PRB0000001', 'chg-1');

    expect(vi.mocked(snowFetch)).toHaveBeenCalledWith('/api/now/table/problem/sys-PRB0000001', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ rfc: 'chg-1' }),
    }));
  });

  it('scans the change\'s Jira issues and pairs each PRB found with its ServiceNow record', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ key: 'ENCUC-1', fields: { summary: 'PRB0000001 fix' } });
    vi.mocked(snowFetch).mockResolvedValue({ result: [buildProblemRecord('PRB0000001')] });

    const rows = await scanIssuesForProblems(['ENCUC-1']);

    expect(rows).toEqual([expect.objectContaining({ prbNumber: 'PRB0000001', issueKeys: ['ENCUC-1'], problem: expect.objectContaining({ sysId: 'sys-PRB0000001' }) })]);
  });

  it('links a new change to every PRB not already linked elsewhere, and says which it left alone', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ key: 'ENCUC-1', fields: { summary: 'PRB0000001 and PRB0000002' } });
    vi.mocked(snowFetch).mockImplementation(async (requestPath: string) => (String(requestPath).includes('sysparm_query')
      ? { result: [buildProblemRecord('PRB0000001'), buildProblemRecord('PRB0000002', { value: 'chg-9', display_value: 'CHG0009999' })] }
      : { result: {} }));

    const outcome = await linkProblemsToNewChange('chg-1', ['ENCUC-1']);

    expect(outcome.linkedNumbers).toEqual(['PRB0000001']);
    expect(outcome.skipped).toEqual([{ prbNumber: 'PRB0000002', reason: 'already linked to CHG0009999' }]);
  });
});
