// jira.test.ts — Runtime shape checks for Jira domain type literals.

import { describe, expect, it } from 'vitest';

import type {
  JiraBoard,
  JiraFilter,
  JiraIssue,
  JiraSprint,
  JiraUser,
} from './jira.ts';

describe('jira types', () => {
  it('accepts a jira user literal with the expected keys', () => {
    const jiraUser: JiraUser = {
      accountId: 'abc123',
      displayName: 'Example User',
      emailAddress: 'example@example.com',
      avatarUrls: { '48x48': 'https://jira.example.com/avatar.png' },
    };

    expect(jiraUser).toHaveProperty('accountId');
    expect(jiraUser).toHaveProperty('displayName');
    expect(jiraUser).toHaveProperty('emailAddress');
    expect(jiraUser).toHaveProperty('avatarUrls');
  });

  it('accepts a jira issue literal with the expected nested keys', () => {
    const jiraIssue: JiraIssue = {
      id: '10001',
      key: 'ABC-123',
      fields: {
        summary: 'Example summary',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: { name: 'Medium', iconUrl: 'https://jira.example.com/priority.png' },
        assignee: null,
        reporter: null,
        issuetype: { name: 'Story', iconUrl: 'https://jira.example.com/type.png' },
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-02T00:00:00.000Z',
        description: null,
      },
    };

    expect(jiraIssue).toHaveProperty('id');
    expect(jiraIssue).toHaveProperty('key');
    expect(jiraIssue.fields).toHaveProperty('summary');
    expect(jiraIssue.fields).toHaveProperty('status');
    expect(jiraIssue.fields).toHaveProperty('priority');
    expect(jiraIssue.fields).toHaveProperty('assignee');
    expect(jiraIssue.fields).toHaveProperty('reporter');
    expect(jiraIssue.fields).toHaveProperty('issuetype');
    expect(jiraIssue.fields).toHaveProperty('created');
    expect(jiraIssue.fields).toHaveProperty('updated');
    expect(jiraIssue.fields).toHaveProperty('description');
  });

  it('accepts jira board, sprint, and filter literals', () => {
    const jiraBoard: JiraBoard = {
      id: 7,
      name: 'Platform Board',
      type: 'scrum',
      projectKey: 'ABC',
    };
    const jiraSprint: JiraSprint = {
      id: 19,
      name: 'Sprint 19',
      state: 'active',
      startDate: '2025-01-01',
      endDate: '2025-01-14',
    };
    const jiraFilter: JiraFilter = {
      id: '20100',
      name: 'My open work',
      jql: 'assignee = currentUser()',
      isFavorite: true,
    };

    expect(jiraBoard).toHaveProperty('projectKey');
    expect(jiraSprint).toHaveProperty('startDate');
    expect(jiraSprint).toHaveProperty('endDate');
    expect(jiraFilter).toHaveProperty('jql');
    expect(jiraFilter).toHaveProperty('isFavorite');
  });
});
