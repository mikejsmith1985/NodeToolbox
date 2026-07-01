// intakeLabel.test.ts — Covers label build, stampability, and id extraction from labels.

import { describe, expect, it } from 'vitest';

import { buildIntakeLabel, extractSubmissionId, isStampableId } from './intakeLabel.ts';

const GUID = '2f58d5cd-de0b-4c42-80c4-a1fd8e3ae503';

describe('intakeLabel', () => {
  it('builds intake-<id> for a valid GUID', () => {
    expect(buildIntakeLabel(GUID)).toBe(`intake-${GUID}`);
  });

  it('trims surrounding whitespace before building', () => {
    expect(buildIntakeLabel(`  ${GUID}  `)).toBe(`intake-${GUID}`);
  });

  it('returns null for a blank id', () => {
    expect(buildIntakeLabel('   ')).toBeNull();
    expect(isStampableId('   ')).toBe(false);
  });

  it('returns null for an id containing whitespace (not a valid Jira label)', () => {
    expect(buildIntakeLabel('has space')).toBeNull();
    expect(isStampableId('has space')).toBe(false);
  });

  it('extracts the submission id from a label set', () => {
    expect(extractSubmissionId(['backlog', `intake-${GUID}`, 'team-x'])).toBe(GUID);
  });

  it('returns null when no intake label is present', () => {
    expect(extractSubmissionId(['backlog', 'team-x'])).toBeNull();
    expect(extractSubmissionId([])).toBeNull();
  });

  it('ignores a bare prefix with no id', () => {
    expect(extractSubmissionId(['intake-'])).toBeNull();
  });
});
