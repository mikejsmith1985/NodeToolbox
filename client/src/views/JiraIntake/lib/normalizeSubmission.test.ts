// normalizeSubmission.test.ts — Covers the flat shape, nested/dotted shapes, extras preservation,
// Unicode integrity, and the record-not-throw behavior for missing required fields.

import { describe, expect, it } from 'vitest';

import { normalizeSubmission } from './normalizeSubmission.ts';

describe('normalizeSubmission', () => {
  it('normalizes the flat spreadsheet shape from the real Teams export', () => {
    const row = {
      id: '2f58d5cd-de0b-4c42-80c4-a1fd8e3ae503',
      submittedAt: '2026-07-01T11:25:42.1202199Z',
      status: 'New',
      submitterDisplayName: 'Michael Smith',
      submitterEmail: 'Michael_Smith3@hcsc.com',
      summary: 'This is a formal request to do work',
      description: 'I’d like work to be done',
      acceptanceCriteria: 'Given work is done then work is done',
      issueType: 'Story',
      priority: 'Highest',
    };
    const submission = normalizeSubmission(row, 3);
    expect(submission.id).toBe('2f58d5cd-de0b-4c42-80c4-a1fd8e3ae503');
    expect(submission.submitter.email).toBe('Michael_Smith3@hcsc.com');
    expect(submission.fields.priority).toBe('Highest');
    expect(submission.parseErrors).toEqual([]);
    expect(submission.rowIndex).toBe(3);
  });

  it('preserves Unicode / smart quotes verbatim', () => {
    const row = { id: 'a', summary: 's', description: 'the thing should “do stuff”' };
    const submission = normalizeSubmission(row, 0);
    expect(submission.fields.description).toBe('the thing should “do stuff”');
  });

  it('accepts dotted-column keys (flattened JSON export)', () => {
    const row = {
      id: 'b',
      'submitter.email': 'jane@corp.com',
      'submitter.displayName': 'Jane',
      'fields.summary': 'Dotted summary',
      'fields.issueType': 'Bug',
    };
    const submission = normalizeSubmission(row, 0);
    expect(submission.submitter.email).toBe('jane@corp.com');
    expect(submission.fields.summary).toBe('Dotted summary');
    expect(submission.fields.issueType).toBe('Bug');
  });

  it('accepts genuinely nested objects (nested JSON record)', () => {
    const row = {
      id: 'c',
      submitter: { displayName: 'Nested Nancy', email: 'nancy@corp.com' },
      fields: { summary: 'Nested summary', priority: 'Low' },
    };
    const submission = normalizeSubmission(row as unknown as Record<string, unknown>, 0);
    expect(submission.submitter.displayName).toBe('Nested Nancy');
    expect(submission.fields.summary).toBe('Nested summary');
    expect(submission.fields.priority).toBe('Low');
  });

  it('preserves unknown columns as extras', () => {
    const row = { id: 'd', summary: 's', __PowerAppsId__: 'xyz', extraNote: 'keep me' };
    const submission = normalizeSubmission(row, 0);
    expect(submission.extras).toEqual({ __PowerAppsId__: 'xyz', extraNote: 'keep me' });
  });

  it('records — never throws — when required fields are blank', () => {
    const submission = normalizeSubmission({ status: 'New', description: 'd' }, 5);
    expect(submission.parseErrors).toContain('Missing submission id');
    expect(submission.parseErrors).toContain('Missing required field: summary');
  });

  it('defaults a missing status to New', () => {
    const submission = normalizeSubmission({ id: 'e', summary: 's' }, 0);
    expect(submission.status).toBe('New');
  });

  it('reads the project (team name) column', () => {
    const submission = normalizeSubmission({ id: 'f', summary: 's', project: 'Cleanup Crew' }, 0);
    expect(submission.fields.project).toBe('Cleanup Crew');
  });
});
