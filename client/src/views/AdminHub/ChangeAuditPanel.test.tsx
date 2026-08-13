// ChangeAuditPanel.test.tsx — Covers the panel's controls, its rendering of each verdict, and the
// two things it must never do: name any tooling in its copy, or present an unproven change as
// hand-made when the local record does not cover it.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChangeAuditPanel from './ChangeAuditPanel.tsx';
import { auditStatusChanges, fetchWriteJournal } from './changeAudit.ts';

vi.mock('./changeAudit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./changeAudit.ts')>();
  return { ...actual, auditStatusChanges: vi.fn(), fetchWriteJournal: vi.fn() };
});

const auditMock = vi.mocked(auditStatusChanges);
const journalMock = vi.mocked(fetchWriteJournal);

function buildChange(overrides = {}) {
  return {
    issueKey: 'ENFCT-2000',
    issueSummary: 'A story',
    atIso: '2026-08-13T05:00:00.000Z',
    fromStatus: 'To Do',
    toStatus: 'Cancelled',
    authorDisplayName: 'Smith, Michael (CTR)',
    companionFields: ['Fix Version', 'resolution'],
    origin: 'hand-made' as const,
    evidence: 'Nothing corroborates this change.',
    burstPartnerKeys: [],
    ...overrides,
  };
}

function buildResult(changes: ReturnType<typeof buildChange>[], journalCoverageStartIso: string | null) {
  return { changes, scannedIssueCount: changes.length, jql: 'status CHANGED TO "Cancelled"', journalCoverageStartIso };
}

afterEach(() => {
  vi.clearAllMocks();
});

async function runReview() {
  fireEvent.click(screen.getByRole('button', { name: /review changes/i }));
  await waitFor(() => expect(auditMock).toHaveBeenCalled());
}

describe('ChangeAuditPanel', () => {
  it('defaults to reviewing cancellations — the case it was built for', () => {
    render(<ChangeAuditPanel />);
    expect(screen.getByLabelText(/status moved into/i)).toHaveValue('Cancelled');
  });

  it('passes the operator\'s status, date and project scope through to the review', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockResolvedValue(buildResult([], null));
    render(<ChangeAuditPanel />);

    fireEvent.change(screen.getByLabelText(/status moved into/i), { target: { value: 'Closed' } });
    fireEvent.change(screen.getByLabelText(/^since$/i), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/project keys/i), { target: { value: 'ENFCT, DENP' } });
    await runReview();

    expect(auditMock).toHaveBeenCalledWith('Closed', '2026-08-01', ['ENFCT', 'DENP'], []);
  });

  it('renders each verdict with its evidence and the fields that moved alongside', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockResolvedValue(buildResult([
      buildChange({ issueKey: 'A-1', origin: 'assisted-confirmed', evidence: 'This machine recorded a transition write.' }),
      buildChange({ issueKey: 'A-2', origin: 'batch', evidence: 'Changed within 10s of 3 other issues.' }),
    ], '2026-08-01T00:00:00.000Z'));
    render(<ChangeAuditPanel />);
    await runReview();

    expect(await screen.findByText(/made for you \(recorded on this machine\)/i)).toBeInTheDocument();
    expect(screen.getByText(/part of a bulk operation/i)).toBeInTheDocument();
    expect(screen.getByText(/This machine recorded a transition write\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/Fix Version, resolution/i).length).toBeGreaterThan(0);
  });

  it('warns that nothing can be ruled out when no local record exists yet', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockResolvedValue(buildResult([buildChange({ origin: 'indeterminate' })], null));
    render(<ChangeAuditPanel />);
    await runReview();

    expect(await screen.findByText(/No local write record exists for this period yet/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be determined/i)).toBeInTheDocument();
  });

  it('states where the local record starts when it has one', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockResolvedValue(buildResult([], '2026-08-01T00:00:00.000Z'));
    render(<ChangeAuditPanel />);
    await runReview();

    expect(await screen.findByText(/2026-08-01T00:00:00.000Z/)).toBeInTheDocument();
  });

  it('reports a failed review instead of showing an empty result as success', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockRejectedValue(new Error('Jira said no'));
    render(<ChangeAuditPanel />);
    await runReview();

    expect(await screen.findByText(/Jira said no/i)).toBeInTheDocument();
  });

  it('says plainly when nothing matched', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockResolvedValue(buildResult([], '2026-08-01T00:00:00.000Z'));
    render(<ChangeAuditPanel />);
    await runReview();

    expect(await screen.findByText(/nothing moved into that status in this window/i)).toBeInTheDocument();
  });

  it('names no tooling anywhere in its copy', async () => {
    journalMock.mockResolvedValue([]);
    auditMock.mockResolvedValue(buildResult([buildChange({ origin: 'assisted-confirmed' })], '2026-08-01T00:00:00.000Z'));
    const { container } = render(<ChangeAuditPanel />);
    await runReview();

    await screen.findByText(/made for you/i);
    expect(container.textContent).not.toMatch(/toolbox|automation|bot\b/i);
  });
});
