// ScheduledMovesSection.test.tsx — Booking a change move from inside Release Management.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduledMovesSection, listTargetStatesForChange } from './ScheduledMovesSection.tsx';

/** The tab's class vocabulary; identity mapping is enough for the section's markup. */
const STYLES = new Proxy({}, { get: (_target, className: string) => className }) as Record<string, string>;

/** One Scheduled change, as Release Management already holds it. */
const SCHEDULED_CHANGE = [{
  number: 'CHG0046897', shortDescription: 'Deploy Enrolment', state: 'Scheduled', stateValue: '-2',
}];

/** Routes fetch by URL so each endpoint answers independently. */
function mockEndpoints(options: { bookings?: unknown[]; post?: unknown; run?: unknown } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/run-now')) {
      return { ok: true, json: async () => options.run ?? { ok: true, run: { movedChangeNumbers: [], failures: [], skipReason: '', dueCount: 0 } } } as Response;
    }
    if (url.includes('/bookings') && init?.method === 'POST') {
      return { ok: true, json: async () => options.post ?? { ok: true, bookings: [] } } as Response;
    }
    return { ok: true, json: async () => ({ bookings: options.bookings ?? [] }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('listTargetStatesForChange — only where the change can actually go', () => {
  it('offers ServiceNow-s own next states for a Scheduled change', () => {
    expect(listTargetStatesForChange('-2').map((option) => option.label)).toEqual(['Implement', 'Cancel']);
  });

  it('falls back to every state when the current one is not in the map, rather than to nothing', () => {
    expect(listTargetStatesForChange('999').length).toBeGreaterThan(1);
  });
});

describe('ScheduledMovesSection', () => {
  it('offers your already-loaded changes as a list rather than a box to type into', async () => {
    // A mistyped change number saves cleanly and then silently does nothing, so it is picked.
    mockEndpoints();

    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);

    const changePicker = await screen.findByLabelText('Change to move');
    expect(changePicker.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: /CHG0046897 — Scheduled — Deploy Enrolment/ })).toBeInTheDocument();
  });

  it('offers only the states the selected change can reach', async () => {
    mockEndpoints();
    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);

    await userEvent.selectOptions(await screen.findByLabelText('Change to move'), 'CHG0046897');

    expect(screen.getByRole('option', { name: 'Implement' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('books exactly the change, state and moment that were picked', async () => {
    const fetchMock = mockEndpoints();
    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);
    await screen.findByLabelText('Change to move');

    await userEvent.selectOptions(screen.getByLabelText('Change to move'), 'CHG0046897');
    await userEvent.selectOptions(screen.getByLabelText('Target state'), '1');
    await userEvent.type(screen.getByLabelText('Move at'), '2026-08-31T14:00');
    await userEvent.click(screen.getByRole('button', { name: 'Book Move' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes('/bookings') && (init as RequestInit | undefined)?.method === 'POST');
      expect(postCall).toBeDefined();
      const posted = JSON.parse((postCall![1] as RequestInit).body as string) as Record<string, string>;
      expect(posted.changeNumber).toBe('CHG0046897');
      expect(posted.targetState).toBe('1');
      expect(posted.targetStateLabel).toBe('Implement');
      expect(Date.parse(posted.dueAtIso)).toBe(Date.parse('2026-08-31T14:00'));
    });
  });

  it('clears a chosen target when the change changes, so a stale one cannot be booked', async () => {
    mockEndpoints();
    render(
      <ScheduledMovesSection
        activeChanges={[
          ...SCHEDULED_CHANGE,
          { number: 'CHG0000002', shortDescription: 'Other', state: 'Implement', stateValue: '1' },
        ]}
        styles={STYLES}
      />,
    );
    await screen.findByLabelText('Change to move');

    await userEvent.selectOptions(screen.getByLabelText('Change to move'), 'CHG0046897');
    await userEvent.selectOptions(screen.getByLabelText('Target state'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Change to move'), 'CHG0000002');

    expect(screen.getByLabelText('Target state')).toHaveValue('');
  });

  it('refuses to book without a full selection, instead of posting a booking that cannot run', async () => {
    const fetchMock = mockEndpoints();
    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);
    await screen.findByLabelText('Change to move');

    await userEvent.click(screen.getByRole('button', { name: 'Book Move' }));

    expect(await screen.findByText(/Pick a change and a date and time first/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/bookings') && (init as RequestInit | undefined)?.method === 'POST')).toBeUndefined();
  });

  it('lists what is booked, with the reason a failed one failed', async () => {
    mockEndpoints({
      bookings: [
        { id: 'b1', changeNumber: 'CHG1', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T14:00:00.000Z', status: 'pending', message: '' },
        { id: 'b2', changeNumber: 'CHG2', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T09:00:00.000Z', status: 'failed', message: 'ServiceNow said no' },
      ],
    });

    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);

    expect(await screen.findByText('CHG1')).toBeInTheDocument();
    expect(screen.getByText('ServiceNow said no')).toBeInTheDocument();
  });

  it('offers Cancel only on a booking that has not run', async () => {
    mockEndpoints({
      bookings: [
        { id: 'b1', changeNumber: 'CHG1', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T14:00:00.000Z', status: 'pending', message: '' },
        { id: 'b2', changeNumber: 'CHG2', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T09:00:00.000Z', status: 'done', message: '' },
      ],
    });

    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);

    await screen.findByText('CHG1');
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
  });

  it('says there is nothing to book when no change is assigned to you', async () => {
    mockEndpoints();

    render(<ScheduledMovesSection activeChanges={[]} styles={STYLES} />);

    expect(await screen.findByText(/No active changes are assigned to you/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Change to move')).not.toBeInTheDocument();
  });

  it('reports what Run Due Now did', async () => {
    mockEndpoints({ run: { ok: true, run: { movedChangeNumbers: ['CHG0046897'], failures: [], skipReason: '', dueCount: 1 } } });
    render(<ScheduledMovesSection activeChanges={SCHEDULED_CHANGE} styles={STYLES} />);
    await screen.findByLabelText('Change to move');

    await userEvent.click(screen.getByRole('button', { name: 'Run Due Now' }));

    expect(await screen.findByText(/Moved CHG0046897/)).toBeInTheDocument();
  });
});
