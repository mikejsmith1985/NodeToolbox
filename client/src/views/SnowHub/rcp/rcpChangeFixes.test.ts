// rcpChangeFixes.test.ts — Fixing an existing change's RCP gaps in ServiceNow (GH #415).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import type { RcpChangeFacts } from './rcpChangeFacts.ts';
import {
  buildRcpJustificationPrompt,
  planRcpWindowFix,
  readRcpJustificationReply,
  saveRcpChangeFix,
} from './rcpChangeFixes.ts';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const FACTS: RcpChangeFacts = {
  changeSysId: 'chg-1', changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', stateLabel: 'Scheduled',
  environmentLabel: 'PRD', isProduction: true, riskLabel: 'Low',
  plannedStartUtc: '2026-10-08T15:00:00Z', plannedEndUtc: '2026-10-08T17:00:00Z', totalEstimateMinutes: 150,
  requestedBy: { sysId: 'user-pat', displayName: 'Smith, Pat' }, configItem: { sysId: 'ci-1', displayName: 'Recon Service' },
  ciOwner: { sysId: 'user-dir', displayName: 'Lee, Jordan' }, attachmentFileNames: [],
  justification: 'Fixes the LIS mismatch.', backoutPlan: 'Redeploy v1.4.',
};

describe('saveRcpChangeFix', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
    vi.mocked(snowFetch).mockResolvedValue({ result: {} });
  });

  it('writes only the fixed fields, with dates in ServiceNow\'s UTC format', async () => {
    await saveRcpChangeFix('chg-1', {
      requestedBySysId: 'user-dir',
      plannedStartUtc: '2026-10-10T00:00:00Z',
      plannedEndUtc: '2026-10-10T02:30:00Z',
    });

    expect(snowFetch).toHaveBeenCalledWith('/api/now/table/change_request/chg-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ requested_by: 'user-dir', start_date: '2026-10-10 00:00:00', end_date: '2026-10-10 02:30:00' }),
    }));
  });

  it('refuses a fix with nothing in it', async () => {
    await expect(saveRcpChangeFix('chg-1', {})).rejects.toThrow(/nothing to write/i);
    expect(snowFetch).not.toHaveBeenCalled();
  });
});

describe('planRcpWindowFix', () => {
  it('moves the change to the next approved night long enough for its estimates', () => {
    expect(planRcpWindowFix(FACTS, '2026-10-08T15:00:00Z'))
      .toEqual({ plannedStartUtc: '2026-10-10T00:00:00Z', plannedEndUtc: '2026-10-10T02:30:00Z' });
  });

  it('keeps the current window\'s length when there are no estimates', () => {
    expect(planRcpWindowFix({ ...FACTS, totalEstimateMinutes: null }, '2026-10-08T15:00:00Z')?.plannedEndUtc).toBe('2026-10-10T02:00:00Z');
  });
});

describe('the justification fix', () => {
  it('asks for the justification rewritten to cover the three RCP points, without inventing facts', () => {
    const prompt = buildRcpJustificationPrompt(FACTS);

    expect(prompt).toContain('Fixes the LIS mismatch.');
    expect(prompt).toMatch(/why it must happen during the RCP/i);
    expect(prompt).toMatch(/Jan 19, 2027/);
    expect(prompt).toContain('JUSTIFICATION:');
    expect(prompt).toMatch(/\[CONFIRM:/);
  });

  it('reads the rewritten justification from a pasted reply', () => {
    expect(readRcpJustificationReply('```text\nJUSTIFICATION:\nMust ship during RCP.\n```')).toBe('Must ship during RCP.');
    expect(readRcpJustificationReply('nothing useful')).toBe('');
  });
});
