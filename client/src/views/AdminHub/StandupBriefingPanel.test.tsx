// Render/behaviour tests for the Admin Hub Pre-Standup Briefing panel.

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The panel reads isJiraReady from the connection store via a selector.
vi.mock('../../store/connectionStore', () => ({
  useConnectionStore: (selector: (state: { isJiraReady: boolean }) => unknown) => selector({ isJiraReady: true }),
}));

import { StandupBriefingPanel } from './StandupBriefingPanel.tsx';

const DEFAULT_CONFIG = {
  teamReports: [],
  artRollup: { confluenceSpaceKey: '', targetBlogUrl: '', triggerUrl: '', triggerSecret: '', scheduleTime: '09:00', isEnabled: false },
};

describe('StandupBriefingPanel', () => {
  beforeEach(() => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => DEFAULT_CONFIG });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the Pre-Standup Briefing and ART Rollup sections', async () => {
    render(<StandupBriefingPanel />);
    expect(await screen.findByText('📋 Pre-Standup Briefing')).toBeInTheDocument();
    expect(screen.getByText('📊 ART Rollup')).toBeInTheDocument();
  });

  it('loads the standup config from the server on mount', async () => {
    render(<StandupBriefingPanel />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/standup/config'));
  });
});
