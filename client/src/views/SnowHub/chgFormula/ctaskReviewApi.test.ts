// ctaskReviewApi.test.ts — Reading a change's tasks for the risk check and writing their fixes (GH #395).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import { buildCtaskFixPatch, fetchChangeAttachmentFileNames, fetchReviewedCtasks, saveCtaskFix, saveCtaskPlannedDates } from './ctaskReviewApi.ts';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

function buildCtask(overrides: Partial<ReviewedCtask> = {}): ReviewedCtask {
  return {
    sysId: 'task-1',
    number: 'CTASK0012345',
    shortDescription: 'Deploy recon service',
    description: 'Run the pipeline.',
    typeLabel: 'Implementation',
    isImplementation: true,
    assignedTo: { sysId: 'usr-1', displayName: 'Jane Smith' },
    assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
    configItem: { sysId: 'ci-other', displayName: 'Billing' },
    backoutPlan: '',
    backoutFieldName: 'u_backout_plan',
    ...overrides,
  };
}

describe('fetchReviewedCtasks', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('reads every field of the change\'s tasks, so the backout field can be found', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ sys_id: 'task-1', number: 'CTASK0012345', u_backout_plan: 'Redeploy.' }] });

    const ctasks = await fetchReviewedCtasks('chg-1');

    const requestedPath = vi.mocked(snowFetch).mock.calls[0][0];
    expect(requestedPath).toContain('/api/now/table/change_task?');
    expect(requestedPath).toContain(encodeURIComponent('change_request=chg-1^ORDERBYnumber'));
    expect(requestedPath).toContain('sysparm_display_value=all');
    expect(requestedPath).not.toContain('sysparm_fields');
    expect(ctasks).toEqual([expect.objectContaining({ number: 'CTASK0012345', backoutPlan: 'Redeploy.' })]);
  });

  it('reads no tasks from a reply without records', async () => {
    vi.mocked(snowFetch).mockResolvedValue({});

    expect(await fetchReviewedCtasks('chg-1')).toEqual([]);
  });
});

describe('buildCtaskFixPatch', () => {
  it('sets the CI to the change\'s', () => {
    expect(buildCtaskFixPatch(buildCtask(), { configItemSysId: 'ci-recon' })).toEqual({ cmdb_ci: 'ci-recon' });
  });

  it('writes the backout plan into the instance\'s own backout field', () => {
    expect(buildCtaskFixPatch(buildCtask(), { backoutPlan: 'Stop, redeploy, verify.' })).toEqual({ u_backout_plan: 'Stop, redeploy, verify.' });
  });

  it('writes the backout plan into the description\'s backout section when there is no backout field', () => {
    const patch = buildCtaskFixPatch(buildCtask({ backoutFieldName: null }), { backoutPlan: 'Stop, redeploy, verify.' });

    expect(patch).toEqual({ description: 'Run the pipeline.\n\n--- Backout plan ---\nStop, redeploy, verify.\n--- End backout plan ---' });
  });
});

describe('saveCtaskFix', () => {
  it('patches the task by its sys_id', async () => {
    vi.mocked(snowFetch).mockReset().mockResolvedValue({ result: {} });

    await saveCtaskFix(buildCtask(), { configItemSysId: 'ci-recon' });

    expect(snowFetch).toHaveBeenCalledWith('/api/now/table/change_task/task-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ cmdb_ci: 'ci-recon' }),
    }));
  });

  it('refuses a fix with nothing to write rather than sending an empty update', async () => {
    vi.mocked(snowFetch).mockReset();

    await expect(saveCtaskFix(buildCtask(), {})).rejects.toThrow(/nothing to write/i);
    expect(snowFetch).not.toHaveBeenCalled();
  });
});

describe('fetchChangeAttachmentFileNames', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('reads the names of the files attached to the change', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ file_name: 'CHG0012345-test-evidence.zip' }, { file_name: '' }] });

    expect(await fetchChangeAttachmentFileNames('chg-1')).toEqual(['CHG0012345-test-evidence.zip']);
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('table_name%3Dchange_request%5Etable_sys_id%3Dchg-1');
  });
});

describe('saveCtaskPlannedDates', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('writes the task\'s planned start and end in the format the Table API stores', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: {} });

    await saveCtaskPlannedDates(buildCtask(), '2026-10-10T05:00', '2026-10-10T05:45');

    expect(vi.mocked(snowFetch).mock.calls[0][0]).toBe('/api/now/table/change_task/task-1');
    expect(JSON.parse(String((vi.mocked(snowFetch).mock.calls[0][1] as RequestInit).body))).toEqual({
      planned_start_date: '2026-10-10 05:00:00',
      planned_end_date: '2026-10-10 05:45:00',
    });
  });
});

