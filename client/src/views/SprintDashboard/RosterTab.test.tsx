// RosterTab.test.tsx — Rendering tests for the Team Dashboard roster builder.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../services/jiraApi.ts';
import { snowFetch } from '../../services/snowApi.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
import RosterTab from './RosterTab.tsx';

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

vi.mock('../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

vi.mock('../SnowHub/components/SnowLookupField.tsx', () => ({
  SnowLookupField: ({
    label,
    value,
    onChange,
    isDisabled,
  }: {
    label: string;
    value: { sysId: string; displayName: string };
    onChange: (reference: { sysId: string; displayName: string }) => void;
    isDisabled?: boolean;
  }) => (
    <button
      aria-label={label}
      disabled={isDisabled}
      onClick={() => onChange({ sysId: 'snow-user-123', displayName: value.displayName || 'Jordan Joiner SN' })}
      type="button"
    >
      {value.displayName || label}
    </button>
  ),
}));

function buildIssue(issueKey: string, assigneeName: string): JiraIssue {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary: issueKey,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: {
        accountId: assigneeName.toLowerCase().replace(/\s+/g, '-'),
        displayName: assigneeName,
        emailAddress: `${assigneeName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        avatarUrls: {},
      },
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2026-05-01T00:00:00.000Z',
      updated: '2026-05-02T00:00:00.000Z',
      description: null,
      fixVersions: [],
    },
  };
}

describe('RosterTab', () => {
  beforeEach(() => {
    localStorage.clear();
    useStandupRosterStore.setState({ rosterMembers: [] });
    useSettingsStore.setState({ sprintDashboardActiveTeam: '' });
    useConnectionStore.setState({
      isJiraReady: false,
      isSnowReady: false,
      isJiraVerified: false,
      isSnowVerified: false,
      isConfluenceReady: false,
      isGitHubReady: false,
      proxyStatus: null,
      relayBridgeStatus: {
        system: 'snow',
        isConnected: true,
        hasSessionToken: true,
        lastPingAt: new Date().toISOString(),
        version: 'test',
      },
    });
    vi.mocked(jiraGet).mockReset();
    vi.mocked(snowFetch).mockReset();
  });

  it('adds sprint assignees to the roster from the quick-pick list', () => {
    render(<RosterTab issues={[buildIssue('TBX-1', 'Alice Adams'), buildIssue('TBX-2', 'Bob Brown')]} projectKey="TBX" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Alice Adams' }));

    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(useStandupRosterStore.getState().rosterMembers).toHaveLength(1);
  });

  it('supports manual roster entries and removal', () => {
    render(<RosterTab issues={[]} projectKey="TBX" />);

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Taylor Teammate' } });
    fireEvent.change(screen.getByLabelText('Jira assignee value'), { target: { value: 'Taylor Teammate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(screen.getByText('Taylor Teammate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Taylor Teammate' }));

    expect(screen.queryByText('Taylor Teammate')).not.toBeInTheDocument();
  });

  it('removes the old paste-import workflow from the roster settings', () => {
    render(<RosterTab issues={[]} projectKey="TBX" />);

    expect(screen.queryByText('Paste importer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Paste team roster')).not.toBeInTheDocument();
  });

  it('filters visible roster cards to the active team and assigns quick-add members to that team', () => {
    useStandupRosterStore.getState().replaceRosterMembers([
      {
        displayName: 'Alice Adams',
        assigneeQueryValue: 'Alice Adams',
        teamName: 'Transformers',
      },
      {
        displayName: 'Bob Brown',
        assigneeQueryValue: 'Bob Brown',
        teamName: 'Clean Up Crew',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');

    render(<RosterTab issues={[buildIssue('TBX-1', 'Jordan Joiner')]} projectKey="TBX" />);

    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Jordan Joiner' }));

    expect(useStandupRosterStore.getState().rosterMembers.find(
      (rosterMember) => rosterMember.displayName === 'Jordan Joiner',
    )?.teamName).toBe('Transformers');
  });

  it('searches Jira users and adds the selected result to the active team roster', async () => {
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Existing Transformer',
      assigneeQueryValue: 'Existing Transformer',
      teamName: 'Transformers',
    });
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');
    vi.mocked(jiraGet).mockResolvedValue([
      {
        accountId: 'acct-123',
        displayName: 'Jordan Joiner',
        emailAddress: 'jordan.joiner@example.com',
        avatarUrls: {},
      },
    ]);

    render(<RosterTab issues={[]} projectKey="TBX" />);

    fireEvent.change(screen.getByLabelText('Search Jira project users'), { target: { value: 'Jordan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search project users' }));

    expect(await screen.findByRole('button', { name: 'Add Jordan Joiner' })).toBeInTheDocument();
    expect(vi.mocked(jiraGet)).toHaveBeenCalledWith(
      '/rest/api/2/user/assignable/search?project=TBX&query=Jordan&maxResults=8',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Jordan Joiner' }));

    expect(useStandupRosterStore.getState().rosterMembers).toContainEqual({
      id: 'roster-member:jordan joiner',
      displayName: 'Jordan Joiner',
      assigneeQueryValue: 'Jordan Joiner',
      jiraAccountId: 'acct-123',
      emailAddress: 'jordan.joiner@example.com',
      teamName: 'Transformers',
    });
  });

  it('loads project users, lets the user deselect one, and adds the remaining users to the active team roster', async () => {
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');
    useStandupRosterStore.getState().replaceRosterMembers([
      {
        displayName: 'Existing Transformer',
        assigneeQueryValue: 'Existing Transformer',
        teamName: 'Transformers',
      },
    ]);
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([
        {
          accountId: 'acct-111',
          displayName: 'Jordan Joiner',
          emailAddress: 'jordan.joiner@example.com',
          avatarUrls: {},
        },
        {
          accountId: 'acct-222',
          displayName: 'Taylor Teammate',
          emailAddress: 'taylor.teammate@example.com',
          avatarUrls: {},
        },
      ]);

    render(<RosterTab issues={[]} projectKey="TBX" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load project users' }));

    expect(await screen.findByText('Jordan Joiner')).toBeInTheDocument();
    expect(screen.getByText('Taylor Teammate')).toBeInTheDocument();
    expect(vi.mocked(jiraGet)).toHaveBeenCalledWith(
      '/rest/api/2/user/assignable/search?project=TBX&startAt=0&maxResults=1000',
    );

    fireEvent.click(screen.getByLabelText('Select Jordan Joiner for roster'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected users to roster' }));

    expect(useStandupRosterStore.getState().rosterMembers).toContainEqual({
      id: 'roster-member:taylor teammate',
      displayName: 'Taylor Teammate',
      assigneeQueryValue: 'Taylor Teammate',
      jiraAccountId: 'acct-222',
      emailAddress: 'taylor.teammate@example.com',
      teamName: 'Transformers',
    });
    expect(useStandupRosterStore.getState().rosterMembers).not.toContainEqual(
      expect.objectContaining({
        displayName: 'Jordan Joiner',
      }),
    );
  });

  it('shows a no-users status message when all Jira user enumeration endpoints return empty lists', async () => {
    // Three calls: standard (no param), username= empty, username=. dot wildcard
    vi.mocked(jiraGet).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    render(<RosterTab issues={[]} projectKey="TBX" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load project users' }));

    expect(await screen.findByText('No Jira project users are currently available for TBX.')).toBeInTheDocument();
    // Confirms the full fallback chain: standard -> username= -> username=. (Jira Server dot wildcard)
    expect(vi.mocked(jiraGet)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(jiraGet)).toHaveBeenNthCalledWith(
      1,
      '/rest/api/2/user/assignable/search?project=TBX&startAt=0&maxResults=1000',
    );
    expect(vi.mocked(jiraGet)).toHaveBeenNthCalledWith(
      2,
      '/rest/api/2/user/assignable/search?project=TBX&username=&startAt=0&maxResults=1000',
    );
    expect(vi.mocked(jiraGet)).toHaveBeenNthCalledWith(
      3,
      '/rest/api/2/user/assignable/search?project=TBX&username=.&startAt=0&maxResults=1000',
    );
  });

  it('keeps teamless legacy members visible so they can still be removed after team filtering is introduced', () => {
    useStandupRosterStore.getState().replaceRosterMembers([
      {
        displayName: 'Alice Adams',
        assigneeQueryValue: 'Alice Adams',
        teamName: 'Transformers',
      },
      {
        displayName: 'Legacy Person',
        assigneeQueryValue: 'Legacy Person',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');

    render(<RosterTab issues={[]} projectKey="TBX" />);

    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.getByText('Legacy Person')).toBeInTheDocument();
    expect(screen.getByText('Needs team')).toBeInTheDocument();
  });

  it('links a roster member to a ServiceNow user from the per-person lookup', () => {
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Jordan Joiner',
      assigneeQueryValue: 'Jordan Joiner',
      teamName: 'Transformers',
    });
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');

    render(<RosterTab issues={[]} projectKey="TBX" />);

    fireEvent.click(screen.getByRole('button', { name: 'Link ServiceNow person for Jordan Joiner' }));

    expect(useStandupRosterStore.getState().rosterMembers).toContainEqual({
      id: 'roster-member:jordan joiner',
      displayName: 'Jordan Joiner',
      assigneeQueryValue: 'Jordan Joiner',
      snowUserDisplayName: 'Jordan Joiner SN',
      snowUserSysId: 'snow-user-123',
      teamName: 'Transformers',
    });
  });

  it('loads ServiceNow work beside Jira sprint work for linked roster members', async () => {
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Jordan Joiner',
      assigneeQueryValue: 'Jordan Joiner',
      jiraAccountId: 'jordan-joiner',
      snowUserDisplayName: 'Jordan Joiner SN',
      snowUserSysId: 'snow-user-123',
      teamName: 'Transformers',
    });
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');
    vi.mocked(snowFetch).mockImplementation(async (path: string) => {
      if (path.includes('/incident')) {
        return {
          result: [
            {
              sys_id: 'snow-incident-1',
              number: 'INC0012345',
              short_description: 'Investigate login failures',
              state: 'In Progress',
              priority: '2 - High',
              sys_class_name: 'incident',
              opened_at: '2026-05-03T00:00:00.000Z',
            },
          ],
        };
      }

      return { result: [] };
    });

    render(<RosterTab issues={[buildIssue('TBX-9', 'Jordan Joiner')]} projectKey="TBX" />);

    expect(screen.getByText('Jira sprint work')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh linked Jira + SNow work' }));

    expect(await screen.findByText('INC0012345')).toBeInTheDocument();
    expect(screen.getByText('Investigate login failures')).toBeInTheDocument();
  });
});
