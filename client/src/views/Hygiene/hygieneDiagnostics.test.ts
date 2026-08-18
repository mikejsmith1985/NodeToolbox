// hygieneDiagnostics.test.ts — Pins the troubleshooting report's content.
//
// The report exists to answer, without a screen-share, the two questions that keep coming up when a
// hygiene number is disputed: WHICH BUILD is running, and WHAT DID THE SCAN ACTUALLY SEE.

import { describe, expect, it } from 'vitest';

import { buildHygieneDiagnosticsReport } from './hygieneDiagnostics.ts';
import { resolveHygieneFieldConfig, type HygieneFinding } from './checks/hygieneChecks.ts';

function buildFinding(): HygieneFinding {
  return {
    issue: {
      key: 'ENCUC-2113',
      fields: {
        summary: 'SF - THUB reverting status',
        issuetype: { name: 'Defect' },
        status: { name: 'Ready for Testing', statusCategory: { key: 'indeterminate' } },
        duedate: '2026-07-15',
        customfield_10102: '2026-07-01',
      },
    },
    flags: [{ checkId: 'due-date-overdue', label: 'Due Date reached before completion', severity: 'warn' }],
    programIncrement: 'PI 26.4',
  } as unknown as HygieneFinding;
}

const BASE_INPUT = {
  appVersion: '0.206.4',
  scopeJql: 'project=ENCUC AND statusCategory != Done AND cf[10301] = "PI 26.4"',
  scannedIssueCount: 57,
  totalMatchingCount: 57,
  isTruncated: false,
  fieldConfig: resolveHygieneFieldConfig(),
  findings: [buildFinding()],
  enabledCheckIds: ['due-date-overdue', 'stale'],
};

describe('buildHygieneDiagnosticsReport', () => {
  it('names the running build, so "is this even the new version?" is answerable', () => {
    expect(buildHygieneDiagnosticsReport(BASE_INPUT)).toContain('0.206.4');
  });

  it('says so plainly when the build could not be determined', () => {
    const report = buildHygieneDiagnosticsReport({ ...BASE_INPUT, appVersion: null });
    expect(report).toContain('App version: unknown');
  });

  it('prints the exact JQL the scan ran and how much of it was read', () => {
    const report = buildHygieneDiagnosticsReport(BASE_INPUT);
    expect(report).toContain('project=ENCUC AND statusCategory != Done AND cf[10301] = "PI 26.4"');
    expect(report).toContain('57 of 57');
  });

  it('marks a capped scan, because every count under it is then a floor', () => {
    const report = buildHygieneDiagnosticsReport({ ...BASE_INPUT, scannedIssueCount: 200, totalMatchingCount: 240, isTruncated: true });
    expect(report).toContain('CAPPED');
  });

  it('prints the resolved date field ids, which are the usual suspect', () => {
    const report = buildHygieneDiagnosticsReport(BASE_INPUT);
    expect(report).toContain('customfield_10102');
    expect(report).toContain('customfield_10101');
  });

  it('prints the RAW date values each finding carried, alongside the flags raised', () => {
    // The whole point: if a due-date flag fires but the report shows `duedate: (none)`, the bug is
    // in the fetch; if it shows the date, the bug is in the rendering. One line settles it.
    const report = buildHygieneDiagnosticsReport(BASE_INPUT);
    expect(report).toContain('ENCUC-2113');
    expect(report).toContain('duedate=2026-07-15');
    expect(report).toContain('targetEnd=2026-07-01');
    expect(report).toContain('due-date-overdue');
  });

  it('shows an absent date as absent rather than blank', () => {
    const finding = buildFinding();
    delete (finding.issue.fields as Record<string, unknown>).duedate;
    const report = buildHygieneDiagnosticsReport({ ...BASE_INPUT, findings: [finding] });
    expect(report).toContain('duedate=(none)');
  });

  it('caps the per-issue list so a large scan stays pasteable', () => {
    const manyFindings = Array.from({ length: 80 }, () => buildFinding());
    const report = buildHygieneDiagnosticsReport({ ...BASE_INPUT, findings: manyFindings });
    expect(report).toContain('50 of 80 findings listed');
  });
});
