// describeSubmitter.test.ts — Covers the origin note for full identity and each missing-piece case.

import { describe, expect, it } from 'vitest';

import { describeSubmitter } from './describeSubmitter.ts';
import type { IntakeSubmission } from './intakeTypes.ts';

function submissionWith(displayName: string, email: string): IntakeSubmission {
  return {
    id: 'a', submittedAt: '', status: 'New',
    submitter: { displayName, email },
    fields: { summary: 's', description: '', acceptanceCriteria: '', issueType: '', priority: '', project: '' },
    extras: {}, rowIndex: 0, parseErrors: [],
  };
}

describe('describeSubmitter', () => {
  it('includes the name and email when both are present', () => {
    const note = describeSubmitter(submissionWith('Michael Smith', 'Michael_Smith3@hcsc.com'));
    expect(note).toBe('{quote}\nSubmitted via Teams by *Michael Smith* (Michael_Smith3@hcsc.com)\n{quote}');
  });

  it('uses the name alone when the email is missing', () => {
    expect(describeSubmitter(submissionWith('Jane Doe', ''))).toContain('by *Jane Doe*');
  });

  it('uses the email alone when the name is missing', () => {
    expect(describeSubmitter(submissionWith('', 'jane@corp.com'))).toContain('by jane@corp.com');
  });

  it('falls back to a generic phrase when neither is present', () => {
    expect(describeSubmitter(submissionWith('', ''))).toContain('by an unknown requester');
  });
});
