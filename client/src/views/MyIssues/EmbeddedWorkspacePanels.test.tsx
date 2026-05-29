// EmbeddedWorkspacePanels.test.tsx — Unit tests for the embedded time tracking and git sync panels.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddedGitSyncPanel, EmbeddedTimeTrackingPanel } from './EmbeddedWorkspacePanels.tsx';

const mockState = {
  activeTab: 'time' as const,
  workLogTab: 'timers' as const,
  issueTimers: [],
  workLogEntries: [],
  issueSearchKey: '',
  isSearchingIssue: false,
  issueSearchError: null,
  isSyncRunning: false,
  syncLog: [],
  monitorLog: [],
  lastSyncAt: null,
};

const mockActions = {
  setActiveTab: vi.fn(),
  setWorkLogTab: vi.fn(),
  setIssueSearchKey: vi.fn(),
  searchAndAddIssue: vi.fn(),
  startTimer: vi.fn(),
  pauseTimer: vi.fn(),
  logTimeForTimer: vi.fn(),
  removeTimer: vi.fn(),
  runGitSync: vi.fn(),
  appendSyncLog: vi.fn(),
};

vi.mock('./hooks/useDevWorkspaceState.ts', () => ({
  useDevWorkspaceState: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('./hooks/useDevWorkspaceSettings.ts', () => ({
  useDevWorkspaceSettings: () => ({
    settings: {
      githubPat: '',
      repoFullName: '',
      jiraProjectKey: '',
      jiraBaseUrl: '',
      syncIntervalMinutes: 15,
      maxCommitsPerSync: 50,
      commitKeyPattern: '[A-Z]+-\\d+',
      commitMessageTemplate: '',
      branchPrefixes: '',
      postingStrategy: 'comment',
      monitoredReposText: '',
      branchPrefixesToStrip: '',
      shouldLogMissingJiraKeys: false,
      shouldLogHealthyRuns: false,
    },
    updateSettings: vi.fn(),
  }),
}));

vi.mock('./hooks/useGitHubPollingEngine.ts', () => ({
  useGitHubPollingEngine: () => ({
    isRunning: false,
    nextRunInSeconds: 0,
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    syncNow: vi.fn(),
  }),
}));

describe('EmbeddedTimeTrackingPanel', () => {
  it('renders the issue search input', () => {
    render(<EmbeddedTimeTrackingPanel />);

    expect(screen.getByPlaceholderText('Issue key e.g. TBX-42')).toBeInTheDocument();
  });
});

describe('EmbeddedGitSyncPanel', () => {
  it('renders the git sync start button', () => {
    render(<EmbeddedGitSyncPanel />);

    expect(screen.getByRole('button', { name: '▶ Start Sync' })).toBeInTheDocument();
  });
});
