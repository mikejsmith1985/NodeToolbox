// client/src/api/reportDelivery.ts — Client caller for server-mediated report
// webhook delivery. Posts the on-screen report to POST /api/reports/deliver; the
// server resolves the team's Atlassian Automation webhook, validates the host,
// redacts secrets, and sends. Network failures resolve to a non-ok result so
// callers never have to wrap this in try/catch.

export type ReportSurface = 'standup-briefing' | 'scope-change' | 'feature-change';

export interface DeliverReportRequest {
  surface: ReportSurface;
  teamId: string;
  report: unknown;
}

export interface DeliverReportResult {
  ok: boolean;
  status?: number;
  redactionApplied: boolean;
  redactionCount: number;
  message: string;
}

/**
 * Delivers a generated report to the team's Automation webhook via the server.
 *
 * @param request - The surface id, team id, and the report content to send.
 * @returns A structured result; never throws.
 */
export async function deliverReport(request: DeliverReportRequest): Promise<DeliverReportResult> {
  try {
    const response = await fetch('/api/reports/deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as Partial<DeliverReportResult>;
    return {
      ok: Boolean(body.ok),
      status: body.status,
      redactionApplied: Boolean(body.redactionApplied),
      redactionCount: body.redactionCount ?? 0,
      message: body.message ?? (body.ok ? 'Delivered.' : 'Delivery failed.'),
    };
  } catch (networkError) {
    const message = networkError instanceof Error ? networkError.message : 'Network error.';
    return { ok: false, redactionApplied: false, redactionCount: 0, message };
  }
}
