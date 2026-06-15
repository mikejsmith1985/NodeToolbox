// client/src/components/SendToAutomationButton.tsx — Shared "Send to Automation"
// action shown beside a report's existing copy action. Delivers the current
// report to the team's Atlassian Automation webhook via the server and shows the
// outcome (including any redaction notice) inline. The action is additive — the
// manual copy path remains untouched.

import { useCallback, useState } from 'react';

import { deliverReport, type ReportSurface } from '../api/reportDelivery.ts';

interface SendToAutomationButtonProps {
  /** Which report surface is being delivered. */
  surface: ReportSurface;
  /** Team identifier used server-side to resolve the webhook destination. */
  teamId: string;
  /** The report content to send (string or structured object). */
  report?: unknown;
  /** Optional getter resolved at click time (for content that changes). */
  getReport?: () => unknown;
  /** Optional label override. */
  label?: string;
}

const DEFAULT_LABEL = 'Send to Automation';
const STATUS_RESET_MS = 6000;

/** Returns true when there is no deliverable content. */
function isEmptyReport(report: unknown): boolean {
  if (report == null) return true;
  if (typeof report === 'string') return report.trim() === '';
  if (Array.isArray(report)) return report.length === 0;
  if (typeof report === 'object') return Object.keys(report as object).length === 0;
  return false;
}

export default function SendToAutomationButton({ surface, teamId, report, getReport, label }: SendToAutomationButtonProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const hasDestination = Boolean(teamId && teamId.trim());

  const handleClick = useCallback(async () => {
    const payload = getReport ? getReport() : report;
    if (!hasDestination || isEmptyReport(payload)) return;

    setIsBusy(true);
    setStatus(null);
    const result = await deliverReport({ surface, teamId, report: payload });
    setStatus({ ok: result.ok, text: result.message });
    setIsBusy(false);
    window.setTimeout(() => setStatus(null), STATUS_RESET_MS);
  }, [surface, teamId, report, getReport, hasDestination]);

  return (
    <span className="send-to-automation">
      <button
        type="button"
        onClick={handleClick}
        disabled={!hasDestination || isBusy}
        title={hasDestination
          ? "Deliver this report to your team's Atlassian Automation webhook"
          : 'No Automation webhook configured for this team'}
      >
        {isBusy ? 'Sending…' : (label ?? DEFAULT_LABEL)}
      </button>
      {status && (
        <span role="status" className={status.ok ? 'sta-ok' : 'sta-error'}>
          {status.text}
        </span>
      )}
    </span>
  );
}
