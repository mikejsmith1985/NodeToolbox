// intakeTypes.test.ts — Guards the intake type surface: the schema-version constant and that the
// exported shapes compile with representative values. Pure type module, so this asserts the one
// runtime export and exercises the interfaces via typed fixtures.

import { describe, expect, it } from 'vitest';

import {
  JIRA_INTAKE_STORE_SCHEMA_VERSION,
  type IntakeConfig,
  type IntakeSubmission,
  type JiraIntakeStore,
  type ProcessedEntry,
  type QueueEntry,
} from './intakeTypes.ts';

describe('intakeTypes', () => {
  it('pins the store schema version to 2', () => {
    expect(JIRA_INTAKE_STORE_SCHEMA_VERSION).toBe(2);
  });

  it('accepts a fully-populated submission fixture', () => {
    const submission: IntakeSubmission = {
      id: '2921ea40-6eff-47a5-aecf-ae3b6d7b76aa',
      submittedAt: '2026-06-30T22:31:49.6154481Z',
      status: 'New',
      submitter: { displayName: 'Michael Smith', email: 'Michael_Smith3@hcsc.com' },
      fields: { summary: 'S', description: 'D', acceptanceCriteria: 'AC', issueType: 'Story', priority: 'Medium', project: '' },
      extras: {},
      rowIndex: 0,
      parseErrors: [],
    };
    expect(submission.fields.issueType).toBe('Story');
  });

  it('accepts a config, ledger entry, queue entry, and store fixture', () => {
    const config: IntakeConfig = {
      projectKey: 'ENFCT',
      acceptanceCriteriaFieldId: 'customfield_10200',
      autoCreateOnImport: true,
      updatedAt: '2026-07-01T00:00:00.000Z',
      updatedBy: 'Michael Smith',
    };
    const processed: ProcessedEntry = { id: 'a', jiraKey: 'ENFCT-1', createdAt: '', reporterOutcome: 'matched' };
    const entry: QueueEntry = {
      submission: {
        id: 'a', submittedAt: '', status: 'New',
        submitter: { displayName: '', email: '' },
        fields: { summary: 's', description: '', acceptanceCriteria: '', issueType: '', priority: '', project: '' },
        extras: {}, rowIndex: 0, parseErrors: [],
      },
      state: 'imported',
      jiraKey: 'ENFCT-1',
      blockingReasons: [],
      reporterOutcome: 'matched',
    };
    const store: JiraIntakeStore = {
      schemaVersion: JIRA_INTAKE_STORE_SCHEMA_VERSION,
      updatedAt: '',
      config,
      ledger: [processed],
    };
    expect(store.config?.projectKey).toBe('ENFCT');
    expect(entry.state).toBe('imported');
  });
});
