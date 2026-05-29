// RepoMonitorPanel.test.tsx — Unit tests for the Repo Monitor status panel.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RepoMonitorPanel } from './RepoMonitorPanel.tsx';

vi.mock('../../services/schedulerApi.ts', () => ({
  fetchSchedulerConfig: vi.fn().mockResolvedValue(null),
  fetchSchedulerStatus: vi.fn().mockResolvedValue(null),
  fetchSchedulerResults: vi.fn().mockResolvedValue([]),
  runSchedulerNow: vi.fn().mockResolvedValue(undefined),
  updateSchedulerConfig: vi.fn().mockResolvedValue(undefined),
}));

describe('RepoMonitorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the monitor status indicator in stopped state', () => {
    render(<RepoMonitorPanel />);

    expect(screen.getByText('Monitor Stopped')).toBeInTheDocument();
  });
});
