// rcpChangeFacts.test.ts — Reading what the RCP rules judge off an existing change, and judging it (GH #415).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import {
  buildRcpApprovalEmailContext,
  evaluateRcpChecklist,
  fetchMyInFlightProductionChanges,
  fetchRcpChangeFacts,
  type RcpChangeFacts,
} from './rcpChangeFacts.ts';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const CHANGE_RECORD = {
  sys_id: { value: 'chg-1', display_value: 'chg-1' },
  number: { value: 'CHG0012345', display_value: 'CHG0012345' },
  state: { value: '-2', display_value: 'Scheduled' },
  risk: { value: '3', display_value: 'Moderate' },
  start_date: { value: '2026-10-10 00:30:00', display_value: '10/09/2026 07:30:00 PM' },
  end_date: { value: '2026-10-10 08:00:00', display_value: '10/10/2026 03:00:00 AM' },
  requested_by: { value: 'user-dir', display_value: 'Lee, Jordan' },
  cmdb_ci: { value: 'ci-recon', display_value: 'Recon Service' },
  justification: { value: 'Fixes premiums.', display_value: 'Fixes premiums.' },
  short_description: { value: 'Recon | deploy v1.5 | PRD', display_value: 'Recon | deploy v1.5 | PRD' },
  backout_plan: { value: 'Redeploy v1.4.', display_value: 'Redeploy v1.4.' },
  u_environment: { value: 'prd', display_value: 'PRD' },
};
const TASK_DESCRIPTION = 'Deploy.\n• Implementation: 1 hour\n• Post-deployment validation/monitoring: 30 minutes\n• Backout/recovery and restoration validation: 1 hour';

/** A fake ServiceNow answering each read by its path; `failing` names reads that throw. */
function installServiceNow(failing: string[] = []) {
  vi.mocked(snowFetch).mockImplementation(async (path: string) => {
    if (failing.some((part) => path.includes(part))) throw new Error('403');
    if (path.startsWith('/api/now/table/change_request/')) return { result: CHANGE_RECORD };
    if (path.startsWith('/api/now/table/cmdb_ci/')) return { result: { owned_by: { value: 'user-dir', display_value: 'Lee, Jordan' } } };
    if (path.startsWith('/api/now/attachment')) return { result: [{ file_name: 'Director approval.msg' }] };
    if (path.startsWith('/api/now/table/change_task')) {
      return { result: [{ number: { value: 'CTASK1', display_value: 'CTASK1' }, description: { value: TASK_DESCRIPTION, display_value: TASK_DESCRIPTION } }] };
    }
    return {};
  });
}

describe('fetchRcpChangeFacts', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('reads the change\'s window in UTC, its people, its CI owner, attachments and CTASK estimates', async () => {
    installServiceNow();

    const facts = await fetchRcpChangeFacts('chg-1');

    expect(facts).toEqual(expect.objectContaining({
      changeNumber: 'CHG0012345',
      stateLabel: 'Scheduled',
      riskLabel: 'Moderate',
      isProduction: true,
      plannedStartUtc: '2026-10-10T00:30:00Z',
      plannedEndUtc: '2026-10-10T08:00:00Z',
      requestedBy: { sysId: 'user-dir', displayName: 'Lee, Jordan' },
      ciOwner: { sysId: 'user-dir', displayName: 'Lee, Jordan' },
      attachmentFileNames: ['Director approval.msg'],
      totalEstimateMinutes: 150,
    }));
  });

  it('reports what it could not read as unknown rather than failing the whole check', async () => {
    installServiceNow(['/api/now/attachment', '/cmdb_ci/']);

    const facts = await fetchRcpChangeFacts('chg-1');

    expect(facts.attachmentFileNames).toBeNull();
    expect(facts.ciOwner).toBeNull();
  });
});

describe('evaluateRcpChecklist', () => {
  it('judges all five rules for the change', async () => {
    installServiceNow();
    const facts: RcpChangeFacts = await fetchRcpChangeFacts('chg-1');

    const results = evaluateRcpChecklist(facts, '2026-10-05');

    expect(results.map((result) => [result.ruleId, result.status])).toEqual([
      ['window', 'pass'],
      ['director', 'pass'],
      ['approval', 'pass'],
      ['justification', 'check'],
      ['leadTime', 'pass'],
    ]);
  });
});

describe('buildRcpApprovalEmailContext', () => {
  it('words the email facts from the change, naming the CI owner as the Director', async () => {
    installServiceNow();
    const facts = await fetchRcpChangeFacts('chg-1');

    expect(buildRcpApprovalEmailContext(facts)).toEqual(expect.objectContaining({
      changeNumber: 'CHG0012345',
      directorName: 'Lee, Jordan',
      windowText: 'Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT',
      configItemName: 'Recon Service',
      environmentLabel: 'PRD',
    }));
  });
});

describe('fetchMyInFlightProductionChanges', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('lists my active Production changes that are in Assess, Authorize or Scheduled', async () => {
    const changeRow = (sysId: string, state: string, environment: string) => ({
      sys_id: { value: sysId, display_value: sysId },
      number: { value: `CHG-${sysId}`, display_value: `CHG-${sysId}` },
      state: { value: state, display_value: state },
      u_environment: { value: environment.toLowerCase(), display_value: environment },
    });
    vi.mocked(snowFetch).mockResolvedValue({ result: [
      changeRow('a', 'Scheduled', 'PRD'),
      changeRow('b', 'Implement', 'PRD'),
      changeRow('c', 'Assess', 'REL'),
      changeRow('d', 'Authorize', 'PFIX'),
    ] });

    const changes = await fetchMyInFlightProductionChanges();

    expect(changes).toEqual([
      { changeSysId: 'a', changeNumber: 'CHG-a', stateLabel: 'Scheduled' },
      { changeSysId: 'd', changeNumber: 'CHG-d', stateLabel: 'Authorize' },
    ]);
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain(encodeURIComponent('assigned_to=javascript:gs.getUserID()^active=true'));
  });
});
