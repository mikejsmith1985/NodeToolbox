// RosterTab.test.tsx — Rendering tests for the Team Dashboard roster builder.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
import RosterTab from './RosterTab.tsx';

const IMPORT_SAMPLE_TEXT = `#

Team

Name

Role

Email

Location / Time Zone

Lan ID

Working Hours

1

Clean Up Crew

Amber Cannon

Scrum Master

2

QE

Bhargavi Somagutta (6/30)

QE

Bhargavi.Somagutta@cignahealthcare.com

India, GMT+5:30

M07322`;

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
  });

  it('adds sprint assignees to the roster from the quick-pick list', () => {
    render(<RosterTab issues={[buildIssue('TBX-1', 'Alice Adams'), buildIssue('TBX-2', 'Bob Brown')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Alice Adams' }));

    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(useStandupRosterStore.getState().rosterMembers).toHaveLength(1);
  });

  it('supports manual roster entries and removal', () => {
    render(<RosterTab issues={[]} />);

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Taylor Teammate' } });
    fireEvent.change(screen.getByLabelText('Jira assignee value'), { target: { value: 'Taylor Teammate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to roster' }));

    expect(screen.getByText('Taylor Teammate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Taylor Teammate' }));

    expect(screen.queryByText('Taylor Teammate')).not.toBeInTheDocument();
  });

  it('previews pasted roster members and merges them into the current roster', () => {
    render(<RosterTab issues={[]} />);

    fireEvent.change(screen.getByLabelText('Paste team roster'), {
      target: { value: IMPORT_SAMPLE_TEXT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge imported members' }));

    expect(screen.getByText('Bhargavi Somagutta')).toBeInTheDocument();
    expect(screen.getByText('Team: QE')).toBeInTheDocument();
    expect(screen.getByText('Role: QE')).toBeInTheDocument();
    expect(useStandupRosterStore.getState().rosterMembers).toHaveLength(2);
    expect(useStandupRosterStore.getState().rosterMembers[0].assigneeQueryValue).toBe('Amber Cannon');
  });

  it('replaces the current roster when the imported roster is applied as a replacement', () => {
    useStandupRosterStore.getState().addRosterMember({
      assigneeQueryValue: 'Existing Person',
      displayName: 'Existing Person',
    });

    render(<RosterTab issues={[]} />);

    fireEvent.change(screen.getByLabelText('Paste team roster'), {
      target: { value: IMPORT_SAMPLE_TEXT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace current roster' }));

    expect(screen.queryByText('Existing Person')).not.toBeInTheDocument();
    expect(useStandupRosterStore.getState().rosterMembers.map((rosterMember) => rosterMember.displayName)).toEqual([
      'Amber Cannon',
      'Bhargavi Somagutta',
    ]);
  });
});
