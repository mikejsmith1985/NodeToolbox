// DevPanelView.test.tsx — Verifies the standalone Dev Panel renders live Jira API activity.

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DevPanelView from './DevPanelView.tsx';

const API_EVENT_NAME = 'toolbox:api';

function dispatchApiEvent(apiEventDetail: { method: string; url: string; status: number | null; durationMs: number; errorMessage?: string | null }): void {
  act(() => {
    window.dispatchEvent(new CustomEvent(API_EVENT_NAME, { detail: apiEventDetail }));
  });
}

function renderDevPanelView() {
  return render(<DevPanelView />);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DevPanelView', () => {
  it('shows an empty state when no API calls have been recorded', () => {
    renderDevPanelView();

    expect(screen.getByText(/No Jira API calls recorded yet/i)).toBeInTheDocument();
  });

  it('renders dispatched API events with method, status, url, and duration', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/search', status: 200, durationMs: 87 });

    const activityTable = screen.getByRole('table', { name: /Jira API activity log/i });
    expect(within(activityTable).getByText('GET')).toBeInTheDocument();
    expect(within(activityTable).getByText('/rest/api/3/search')).toBeInTheDocument();
    expect(within(activityTable).getByText('200')).toBeInTheDocument();
    expect(activityTable).toHaveTextContent('87 ms');
  });

  it('renders network errors with a readable status label and error detail', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/myself', status: null, durationMs: 12, errorMessage: 'Network unavailable' });

    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
  });

  it('drops new events while paused and resumes with later events', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('button', { name: /Pause logging/i }));
    dispatchApiEvent({ method: 'GET', url: '/ignored', status: 200, durationMs: 1 });
    await user.click(screen.getByRole('button', { name: /Resume logging/i }));
    dispatchApiEvent({ method: 'POST', url: '/recorded', status: 201, durationMs: 2 });

    expect(screen.queryByText('/ignored')).not.toBeInTheDocument();
    expect(screen.getByText('/recorded')).toBeInTheDocument();
  });

  it('clears the activity table when the Clear button is clicked', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    dispatchApiEvent({ method: 'PUT', url: '/rest/api/3/issue/TBX-1', status: 204, durationMs: 33 });
    await user.click(screen.getByRole('button', { name: /Clear log/i }));

    expect(screen.queryByText('/rest/api/3/issue/TBX-1')).not.toBeInTheDocument();
    expect(screen.getByText(/No Jira API calls recorded yet/i)).toBeInTheDocument();
  });

  it('exports CSV by creating an object URL and clicking a download link', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dev-panel-csv');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/search', status: 200, durationMs: 87 });
    await user.click(screen.getByRole('button', { name: /Export CSV/i }));

    expect(createObjectUrlSpy).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:dev-panel-csv');
  });

  it('disables CSV export while the log is empty', () => {
    renderDevPanelView();

    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeDisabled();
  });

  it('shows counter pills for total calls, errors, and average duration', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/ok', status: 200, durationMs: 100 });
    dispatchApiEvent({ method: 'POST', url: '/bad', status: 500, durationMs: 300, errorMessage: 'boom' });

    expect(screen.getByText('Total calls')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Avg duration')).toBeInTheDocument();
    expect(screen.getByText('200 ms')).toBeInTheDocument();
  });

  it('formats the timestamp column as HH:MM:SS', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'DELETE', url: '/rest/api/3/issue/TBX-2', status: 204, durationMs: 8 });

    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  });
});
