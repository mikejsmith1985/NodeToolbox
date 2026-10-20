// changeReadinessFacts.test.ts — Gathering the readiness facts for one change from the existing readers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { fetchChangeTaskRecords } from '../chgFormula/ctaskReviewApi.ts';
import { fetchChangeOutages } from '../outage/changeOutageRecord.ts';
import { scanIssuesForProblems, type ChangeProblemRow } from '../problems/changeProblems.ts';
import { fetchRcpChangeFacts, type RcpChangeFacts } from '../rcp/rcpChangeFacts.ts';
import { buildChangeReadiness } from './changeReadiness.ts';
import {
  gatherChangeReadinessFacts,
  readPrbLinkStatus,
  readReadinessCtask,
  type ReadinessGatherOptions,
} from './changeReadinessFacts.ts';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../chgFormula/ctaskReviewApi.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chgFormula/ctaskReviewApi.ts')>()),
  fetchChangeTaskRecords: vi.fn(),
}));
vi.mock('../outage/changeOutageRecord.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../outage/changeOutageRecord.ts')>()),
  fetchChangeOutages: vi.fn(),
}));
vi.mock('../problems/changeProblems.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../problems/changeProblems.ts')>()),
  scanIssuesForProblems: vi.fn(),
}));
vi.mock('../rcp/rcpChangeFacts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rcp/rcpChangeFacts.ts')>()),
  fetchRcpChangeFacts: vi.fn(),
}));

/** A Table API field read with display values. */
function tableField(value: string, displayValue = value) {
  return { value, display_value: displayValue };
}

const CHANGE_RECORD = {
  sys_id: tableField('chg-1'),
  number: tableField('CHG0012345'),
  state: tableField('-4', 'Assess'),
  assigned_to: tableField('user-1', 'Lee, Jordan'),
  cmdb_ci: tableField('ci-recon', 'Recon Service'),
  short_description: tableField('Recon | deploy v1.5 | PRD'),
  description: tableField('Deploys ENCUC-77 and ENCUC-78.'),
  justification: tableField('Fixes premiums.'),
  risk_impact_analysis: tableField('Moderate.'),
  implementation_plan: tableField('Deploy.'),
  test_plan: tableField('Tested in INT.'),
  backout_plan: tableField('Redeploy v1.4.'),
};

const RCP_FACTS: RcpChangeFacts = {
  changeSysId: 'chg-1', changeNumber: 'CHG0012345', shortDescription: '', stateLabel: 'Assess', environmentLabel: 'PRD',
  isProduction: true, riskLabel: 'Low', plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z',
  totalEstimateMinutes: 60, requestedBy: { sysId: 'user-1', displayName: 'Lee, Jordan' },
  configItem: { sysId: 'ci-recon', displayName: 'Recon Service' }, ciOwner: { sysId: 'user-1', displayName: 'Lee, Jordan' },
  attachmentFileNames: ['approval.msg'], justification: 'Fixes premiums.', backoutPlan: 'Redeploy v1.4.',
};

const TASK_RECORDS = [
  {
    sys_id: tableField('task-1'), number: tableField('CTASK1'), short_description: tableField('Deploy to PRD'),
    description: tableField('Deploy.'), change_task_type: tableField('implementation', 'Implementation'),
    cmdb_ci: tableField('ci-other', 'Other Service'), planned_start_date: tableField('2026-10-10 00:30:00'),
    planned_end_date: tableField(''),
  },
];

const PROBLEM_ROWS: ChangeProblemRow[] = [
  { prbNumber: 'PRB0001', issueKeys: ['ENCUC-77'], problem: { sysId: 'prb-1', number: 'PRB0001', shortDescription: '', stateLabel: '', linkedChange: { sysId: '', displayName: '' } } },
];

const GATHER_OPTIONS: ReadinessGatherOptions = { riskReview: { isReady: true }, isRcpRulesEnabled: true, todayIso: '2026-10-01' };

/** ServiceNow answering the change lookup by number; anything else is a test error. */
function installChangeLookup(result: unknown[] = [CHANGE_RECORD]) {
  vi.mocked(snowFetch).mockImplementation(async (path: string) => {
    if (path.startsWith('/api/now/table/change_request?')) return { result };
    throw new Error(`unexpected read ${path}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  installChangeLookup();
  vi.mocked(fetchRcpChangeFacts).mockResolvedValue(RCP_FACTS);
  vi.mocked(fetchChangeTaskRecords).mockResolvedValue(TASK_RECORDS);
  vi.mocked(fetchChangeOutages).mockResolvedValue([]);
  vi.mocked(scanIssuesForProblems).mockResolvedValue(PROBLEM_ROWS);
});

describe('gatherChangeReadinessFacts', () => {
  it('reads every fact for the change', async () => {
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(gathered.changeSysId).toBe('chg-1');
    expect(gathered.facts.change).toEqual({ changeNumber: 'CHG0012345', stateLabel: 'Assess', ownerName: 'Lee, Jordan', configItemName: 'Recon Service' });
    expect(gathered.facts.textFields?.riskImpact).toBe('Moderate.');
    expect(gathered.facts.isProduction).toBe(true);
    expect(gathered.facts.plannedWindow).toEqual({ plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z' });
    expect(gathered.facts.outageCount).toBe(0);
    expect(gathered.facts.attachmentFileNames).toEqual(['approval.msg']);
    expect(gathered.facts.rcpChecks).toHaveLength(5);
    expect(gathered.facts.riskReview).toEqual({ isReady: true });
    expect(gathered.facts.ctasks).toEqual([
      { number: 'CTASK1', isImplementation: true, isConfigItemMatching: false, hasBackoutPlan: false, hasPlannedDates: false },
    ]);
    expect(gathered.facts.prbs).toEqual([{ prbNumber: 'PRB0001', linkStatus: 'unlinked' }]);
  });

  it('scans the Jira issues the change text names for PRBs', async () => {
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(scanIssuesForProblems).toHaveBeenCalledWith(['ENCUC-77', 'ENCUC-78']);
    expect(gathered.issueKeys).toEqual(['ENCUC-77', 'ENCUC-78']);
  });

  it('skips the PRB scan when the change names no Jira issue', async () => {
    installChangeLookup([{ ...CHANGE_RECORD, description: tableField('No keys here.') }]);
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(scanIssuesForProblems).not.toHaveBeenCalled();
    expect(gathered.facts.prbs).toEqual([]);
  });

  it('leaves the RCP checks out when the rules are off', async () => {
    const gathered = await gatherChangeReadinessFacts('CHG0012345', { ...GATHER_OPTIONS, isRcpRulesEnabled: false });
    expect(gathered.facts.isRcpActive).toBe(false);
    expect(gathered.facts.rcpChecks).toEqual([]);
  });

  it('turns one failed read into one null fact, keeping the rest', async () => {
    vi.mocked(fetchChangeOutages).mockRejectedValue(new Error('HTTP 403 on /api/now/table/cmdb_ci_outage'));
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(gathered.facts.outageCount).toBeNull();
    expect(gathered.facts.failureReasons.outages).toContain('403');
    expect(gathered.facts.ctasks).not.toBeNull();
    expect(gathered.facts.isProduction).toBe(true);
  });

  it('never repeats an internal path or field name from a failed read', async () => {
    vi.mocked(fetchChangeTaskRecords).mockRejectedValue(new Error('Bad sys_id in /api/now/table/change_task u_backout_plan'));
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(gathered.facts.failureReasons.ctasks).not.toMatch(/u_[a-z]|cmdb_ci|customfield_|sys_id|\/api\//);
  });

  it('marks environment, window and attachments unknown when the RCP read fails', async () => {
    vi.mocked(fetchRcpChangeFacts).mockRejectedValue(new Error('timeout'));
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(gathered.facts.isProduction).toBeNull();
    expect(gathered.facts.plannedWindow).toBeNull();
    expect(gathered.facts.attachmentFileNames).toBeNull();
    expect(gathered.facts.rcpChecks).toBeNull();
  });

  it('returns every fact unread when the change itself cannot be found', async () => {
    installChangeLookup([]);
    const gathered = await gatherChangeReadinessFacts('CHG0099999', GATHER_OPTIONS);
    expect(gathered.changeSysId).toBeNull();
    expect(gathered.facts.change).toBeNull();
    expect(gathered.facts.ctasks).toBeNull();
    expect(gathered.facts.failureReasons.change).toContain('CHG0099999');
    expect(fetchChangeTaskRecords).not.toHaveBeenCalled();
    const items = buildChangeReadiness(gathered.facts);
    // Only the risk check — this session's own review, not a read — can still be done.
    expect(items.filter((item) => item.state === 'done').map((item) => item.id)).toEqual(['riskCheck']);
  });

  it('returns every fact unread when the change lookup throws', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('network down'));
    const gathered = await gatherChangeReadinessFacts('CHG0012345', GATHER_OPTIONS);
    expect(gathered.facts.change).toBeNull();
    expect(gathered.facts.isProduction).toBeNull();
  });
});

describe('readReadinessCtask', () => {
  it('reads a matching, dated implementation task with a backout plan as complete', () => {
    const ctaskRecord = {
      ...TASK_RECORDS[0], cmdb_ci: tableField('ci-recon', 'Recon Service'), planned_end_date: tableField('2026-10-10 01:30:00'),
      description: tableField('Deploy.\n--- Backout plan ---\nRedeploy v1.4.\n--- End backout plan ---'),
    };
    expect(readReadinessCtask(ctaskRecord, { sysId: 'ci-recon', displayName: 'Recon Service' })).toEqual({
      number: 'CTASK1', isImplementation: true, isConfigItemMatching: true, hasBackoutPlan: true, hasPlannedDates: true,
    });
  });
});

describe('readPrbLinkStatus', () => {
  const problem = PROBLEM_ROWS[0].problem!;

  it.each([
    [{ ...PROBLEM_ROWS[0], problem: null }, 'notInServiceNow'],
    [PROBLEM_ROWS[0], 'unlinked'],
    [{ ...PROBLEM_ROWS[0], problem: { ...problem, linkedChange: { sysId: 'chg-1', displayName: 'CHG0012345' } } }, 'thisChange'],
    [{ ...PROBLEM_ROWS[0], problem: { ...problem, linkedChange: { sysId: 'chg-9', displayName: 'CHG9' } } }, 'otherChange'],
  ] as const)('reads %o as %s', (row, expectedStatus) => {
    expect(readPrbLinkStatus(row, 'chg-1')).toBe(expectedStatus);
  });
});
