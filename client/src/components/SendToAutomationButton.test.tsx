// Tests for the shared SendToAutomationButton component.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDeliverReport } = vi.hoisted(() => ({ mockDeliverReport: vi.fn() }));
vi.mock('../api/reportDelivery.ts', () => ({ deliverReport: mockDeliverReport }));

import SendToAutomationButton from './SendToAutomationButton.tsx';

describe('SendToAutomationButton', () => {
  beforeEach(() => mockDeliverReport.mockReset());

  it('is disabled when no team destination is configured', () => {
    render(<SendToAutomationButton surface="standup-briefing" teamId="" report="## Briefing" />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(mockDeliverReport).not.toHaveBeenCalled();
  });

  it('delivers the report and shows the success message on click', async () => {
    mockDeliverReport.mockResolvedValue({ ok: true, status: 200, redactionApplied: false, redactionCount: 0, message: 'Delivered to Automation webhook (HTTP 200).' });
    render(<SendToAutomationButton surface="standup-briefing" teamId="ALPHA" report="## Briefing" />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockDeliverReport).toHaveBeenCalledWith({ surface: 'standup-briefing', teamId: 'ALPHA', report: '## Briefing' }));
    expect(await screen.findByText(/Delivered to Automation webhook/)).toBeTruthy();
  });

  it('shows the redaction notice when the server redacted values', async () => {
    mockDeliverReport.mockResolvedValue({ ok: true, status: 200, redactionApplied: true, redactionCount: 2, message: 'Delivered. 2 value(s) redacted before sending.' });
    render(<SendToAutomationButton surface="scope-change" teamId="ALPHA" report={{ rows: 1 }} />);

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText(/2 value\(s\) redacted/)).toBeTruthy();
  });

  it('does not deliver an empty report', async () => {
    render(<SendToAutomationButton surface="standup-briefing" teamId="ALPHA" report="" />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockDeliverReport).not.toHaveBeenCalled();
  });
});
