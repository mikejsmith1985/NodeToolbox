// changePlanDocument.test.ts — The change plan PDF attached to the RCP approval email (GH #441).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import {
  buildAttachmentDocumentHtml,
  buildChangePlanDocumentHtml,
  buildServiceNowChangePdfUrl,
  enrichRcpEmailContextWithPlan,
  fetchChangePlan,
  openChangePlanForPrinting,
  type ChangePlan,
} from './changePlanDocument.ts';
import { buildRcpApprovalEmailContext, type RcpChangeFacts } from './rcpChangeFacts.ts';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const FACTS: RcpChangeFacts = {
  changeSysId: 'chg-1', changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', stateLabel: 'Scheduled',
  environmentLabel: 'PRD', isProduction: true, riskLabel: 'Moderate',
  plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z', totalEstimateMinutes: 150,
  requestedBy: { sysId: 'user-dir', displayName: 'Lee, Jordan' }, configItem: { sysId: 'ci-1', displayName: 'Recon Service' },
  ciOwner: { sysId: 'user-dir', displayName: 'Lee, Jordan' }, attachmentFileNames: [], justification: 'Fixes premiums.',
  backoutPlan: 'Redeploy v1.4.',
};

const PLAN: ChangePlan = {
  changeNumber: 'CHG0012345',
  shortDescription: 'Recon deploy',
  environmentLabel: 'PRD',
  riskLabel: 'Moderate',
  impactLabel: '3 - Low',
  configItemName: 'Recon Service',
  ciOwnerName: 'Lee, Jordan',
  requestedByName: 'Lee, Jordan',
  assignmentGroupName: 'Recon Devs',
  windowText: 'Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT',
  description: '',
  justification: 'Fixes premiums.',
  implementationPlan: 'Step 1 <deploy>\nStep 2 verify',
  riskImpactAnalysis: 'Low risk.',
  backoutPlan: 'Redeploy v1.4.',
  testPlan: 'Tested in REL.',
  tasks: [{
    number: 'CTASK0001', shortDescription: 'Deploy Recon', typeLabel: 'Implementation', assignmentGroupName: 'Recon Devs',
    assignedToName: 'Doe, Sam', configItemName: 'Recon Service', windowText: 'Fri 2026-10-09 7:30 PM → Fri 2026-10-09 8:30 PM CT',
    description: 'Run the pipeline.',
  }],
};

const value = (text: string) => ({ value: text, display_value: text });

describe('buildServiceNowChangePdfUrl', () => {
  it('points at ServiceNow\'s own PDF export of the change form', () => {
    expect(buildServiceNowChangePdfUrl('https://acme.service-now.com/', 'chg-1'))
      .toBe('https://acme.service-now.com/change_request.do?PDF&sys_id=chg-1');
  });

  it('gives nothing when the ServiceNow address or the change is unknown', () => {
    expect(buildServiceNowChangePdfUrl('', 'chg-1')).toBeNull();
    expect(buildServiceNowChangePdfUrl(null, 'chg-1')).toBeNull();
    expect(buildServiceNowChangePdfUrl('https://acme.service-now.com', '')).toBeNull();
  });
});

describe('buildChangePlanDocumentHtml', () => {
  it('names the file after the change and carries every section the approval email promises', () => {
    const documentHtml = buildChangePlanDocumentHtml(PLAN, 'Oct 15, 2026');

    expect(documentHtml).toContain('<title>CHG0012345 change plan</title>');
    for (const heading of ['Implementation plan', 'Risk and impact analysis', 'Backout plan', 'Pre-production and post-implementation testing', 'Change tasks']) {
      expect(documentHtml).toContain(heading);
    }
    expect(documentHtml).toContain('CTASK0001');
    expect(documentHtml).toContain('Doe, Sam');
    expect(documentHtml).toContain('Oct 15, 2026');
  });

  it('escapes ServiceNow text so it prints as written rather than running as markup', () => {
    const documentHtml = buildChangePlanDocumentHtml(PLAN, 'Oct 15, 2026');

    expect(documentHtml).toContain('Step 1 &lt;deploy&gt;');
    expect(documentHtml).not.toContain('<deploy>');
  });

  it('says plainly when a section is empty in ServiceNow, so the gap is visible before sending', () => {
    const documentHtml = buildChangePlanDocumentHtml({ ...PLAN, testPlan: '  ', tasks: [] }, 'Oct 15, 2026');

    expect(documentHtml).toContain('Not provided in ServiceNow.');
    expect(documentHtml).toContain('No change tasks on this change.');
  });
});

describe('fetchChangePlan', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('adds the change\'s plan text and its tasks, with each task\'s window in Central Time', async () => {
    vi.mocked(snowFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/now/table/change_request/')) {
        return { result: {
          implementation_plan: value('Deploy it.'), risk_impact_analysis: value('Low risk.'), test_plan: value('Tested in REL.'),
          description: value('Recon v1.5'), u_impact: value('3 - Low'), assignment_group: value('Recon Devs'),
        } };
      }
      if (path.startsWith('/api/now/table/change_task')) {
        return { result: [{
          number: value('CTASK0001'), short_description: value('Deploy Recon'), assigned_to: value('Doe, Sam'),
          planned_start_date: { value: '2026-10-10 00:30:00', display_value: 'x' },
          planned_end_date: { value: '2026-10-10 01:30:00', display_value: 'x' },
        }] };
      }
      return {};
    });

    const plan = await fetchChangePlan(FACTS);

    expect(plan).toEqual(expect.objectContaining({
      changeNumber: 'CHG0012345',
      implementationPlan: 'Deploy it.',
      riskImpactAnalysis: 'Low risk.',
      testPlan: 'Tested in REL.',
      backoutPlan: 'Redeploy v1.4.',
      impactLabel: '3 - Low',
      assignmentGroupName: 'Recon Devs',
      ciOwnerName: 'Lee, Jordan',
    }));
    expect(plan.windowText).toContain('2026-10-09');
    expect(plan.tasks).toEqual([expect.objectContaining({ number: 'CTASK0001', assignedToName: 'Doe, Sam' })]);
    expect(plan.tasks[0].windowText).toContain('CT');
  });

  it('still builds the plan when the tasks cannot be read', async () => {
    vi.mocked(snowFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/now/table/change_task')) throw new Error('403');
      return { result: { implementation_plan: value('Deploy it.') } };
    });

    const plan = await fetchChangePlan(FACTS);

    expect(plan.implementationPlan).toBe('Deploy it.');
    expect(plan.tasks).toEqual([]);
  });
});

describe('openChangePlanForPrinting', () => {
  it('writes the plan into a new window and opens the print dialog', () => {
    const printWindow = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    const openWindow = vi.fn(() => printWindow as unknown as Window);

    expect(openChangePlanForPrinting('<html></html>', openWindow)).toBe(true);
    expect(printWindow.document.write).toHaveBeenCalledWith('<html></html>');
    expect(printWindow.print).toHaveBeenCalled();
  });

  it('reports a blocked pop-up rather than failing silently', () => {
    expect(openChangePlanForPrinting('<html></html>', () => null)).toBe(false);
  });
});

describe('enrichRcpEmailContextWithPlan', () => {
  it('adds the plan text, the people and one line per task for AI Assist to work the email out from', () => {
    const emailContext = enrichRcpEmailContextWithPlan(buildRcpApprovalEmailContext(FACTS), PLAN);

    expect(emailContext).toEqual(expect.objectContaining({
      changeNumber: 'CHG0012345',
      implementationPlan: 'Step 1 <deploy>\nStep 2 verify',
      riskImpactAnalysis: 'Low risk.',
      testPlan: 'Tested in REL.',
      impactLabel: '3 - Low',
      requestedByName: 'Lee, Jordan',
      assignmentGroupName: 'Recon Devs',
      changeTaskLines: ['CTASK0001 — Implementation — Deploy Recon — Recon Devs / Doe, Sam — Fri 2026-10-09 7:30 PM → Fri 2026-10-09 8:30 PM CT'],
    }));
  });
});

describe('buildAttachmentDocumentHtml', () => {
  it('turns AI Assist\'s attachment into a print-ready page named after the change', () => {
    const documentHtml = buildAttachmentDocumentHtml('CHG0012345 change plan', '## Implementation plan\nStep 1 <deploy>\n- verify\n\n## Backout plan\nRedeploy v1.4.', 'Oct 16, 2026');

    expect(documentHtml).toContain('<title>CHG0012345 change plan</title>');
    expect(documentHtml).toContain('<h1>CHG0012345 change plan</h1>');
    expect(documentHtml).toContain('<h2>Implementation plan</h2>');
    expect(documentHtml).toContain('Step 1 &lt;deploy&gt;\n- verify');
    expect(documentHtml).toContain('<h2>Backout plan</h2>');
    expect(documentHtml).toContain('Oct 16, 2026');
  });
});
