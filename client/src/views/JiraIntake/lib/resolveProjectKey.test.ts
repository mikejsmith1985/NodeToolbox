// resolveProjectKey.test.ts — Covers team→project mapping (case-insensitive), the default-project
// fallback, unmapped teams, and the no-project-configured case.

import { describe, expect, it } from 'vitest';

import { resolveProjectKey } from './resolveProjectKey.ts';
import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

function submissionWith(project: string): IntakeSubmission {
  return {
    id: 'a', submittedAt: '', status: 'New',
    submitter: { displayName: '', email: '' },
    fields: { summary: 's', description: '', acceptanceCriteria: '', issueType: 'Story', priority: '', project },
    extras: {}, rowIndex: 0, parseErrors: [],
  };
}

const CONFIG: IntakeConfig = {
  projectKey: 'DEFLT',
  teamProjectMappings: [{ teamName: 'Cleanup Crew', projectKey: 'ENCUC' }],
  acceptanceCriteriaFieldId: 'customfield_10200',
  autoCreateOnImport: true, updatedAt: '', updatedBy: '',
};

describe('resolveProjectKey', () => {
  it('maps a known team name to its project key (case-insensitive)', () => {
    expect(resolveProjectKey(submissionWith('cleanup crew'), CONFIG)).toEqual({ ok: true, projectKey: 'ENCUC' });
  });

  it('falls back to the default project when the team column is blank', () => {
    expect(resolveProjectKey(submissionWith('  '), CONFIG)).toEqual({ ok: true, projectKey: 'DEFLT' });
  });

  it('fails as unmapped-team when the team name has no mapping', () => {
    const result = resolveProjectKey(submissionWith('Unknown Squad'), CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('unmapped-team');
      expect(result.reason).toContain('Unknown Squad');
    }
  });

  it('fails as no-project when the team is blank and no default project is set', () => {
    const result = resolveProjectKey(submissionWith(''), { ...CONFIG, projectKey: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('no-project');
    }
  });
});
