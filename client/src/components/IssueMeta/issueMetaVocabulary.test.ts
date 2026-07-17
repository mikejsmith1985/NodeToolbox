// issueMetaVocabulary.test.ts — Unit tests for the pure fact → visual-treatment mappings.

import { describe, expect, it } from 'vitest';

import {
  buildAssigneeInitials,
  resolveAgeTone,
  resolveIssueTypeMeta,
  resolvePriorityMeta,
  resolveStatusTone,
} from './issueMetaVocabulary.ts';

describe('resolveStatusTone', () => {
  it('maps the three Jira status categories to their tones', () => {
    expect(resolveStatusTone('new')).toBe('neutral');
    expect(resolveStatusTone('indeterminate')).toBe('progress');
    expect(resolveStatusTone('done')).toBe('success');
  });

  it('degrades unknown or missing categories to neutral, never hiding the fact', () => {
    expect(resolveStatusTone('mystery')).toBe('neutral');
    expect(resolveStatusTone(undefined)).toBe('neutral');
  });
});

describe('resolvePriorityMeta', () => {
  it('maps priorities to the conventional direction and temperature', () => {
    expect(resolvePriorityMeta('Highest')).toEqual({ tone: 'danger', directionGlyph: '⇈' });
    expect(resolvePriorityMeta('Blocker')).toEqual({ tone: 'danger', directionGlyph: '⇈' });
    expect(resolvePriorityMeta('High')).toEqual({ tone: 'warning', directionGlyph: '↑' });
    expect(resolvePriorityMeta('Critical')).toEqual({ tone: 'warning', directionGlyph: '↑' });
    expect(resolvePriorityMeta('Medium')).toEqual({ tone: 'neutral', directionGlyph: '→' });
    expect(resolvePriorityMeta('Low')).toEqual({ tone: 'progress', directionGlyph: '↓' });
    expect(resolvePriorityMeta('Lowest')).toEqual({ tone: 'progress', directionGlyph: '⇊' });
  });

  it('is case-insensitive and degrades unknown priorities to neutral/flat', () => {
    expect(resolvePriorityMeta('hIgH').tone).toBe('warning');
    expect(resolvePriorityMeta('Whatever')).toEqual({ tone: 'neutral', directionGlyph: '→' });
  });
});

describe('resolveIssueTypeMeta', () => {
  it('maps the known issue types to icon + tone', () => {
    expect(resolveIssueTypeMeta('Bug')).toEqual({ icon: '🐞', tone: 'danger' });
    expect(resolveIssueTypeMeta('Defect')).toEqual({ icon: '🐞', tone: 'danger' });
    expect(resolveIssueTypeMeta('Story')).toEqual({ icon: '📗', tone: 'success' });
    expect(resolveIssueTypeMeta('Task')).toEqual({ icon: '✅', tone: 'progress' });
    expect(resolveIssueTypeMeta('Spike')).toEqual({ icon: '🔬', tone: 'neutral' });
    expect(resolveIssueTypeMeta('Feature')).toEqual({ icon: '⚡', tone: 'warning' });
    expect(resolveIssueTypeMeta('Epic')).toEqual({ icon: '⚡', tone: 'warning' });
    expect(resolveIssueTypeMeta('Sub-task')).toEqual({ icon: '🔹', tone: 'neutral' });
  });

  it('degrades unknown types to a generic document with neutral tone', () => {
    expect(resolveIssueTypeMeta('Initiative')).toEqual({ icon: '📄', tone: 'neutral' });
  });
});

describe('resolveAgeTone', () => {
  // Bands derive from the configured stale threshold T: <T comfortable, T..2T warning, >2T overdue.
  it('grades age against the configured stale threshold', () => {
    expect(resolveAgeTone(3, 5)).toBe('neutral');
    expect(resolveAgeTone(5, 5)).toBe('warning');
    expect(resolveAgeTone(10, 5)).toBe('warning');
    expect(resolveAgeTone(11, 5)).toBe('danger');
  });

  it('treats a missing or non-positive threshold as the default 14 days', () => {
    expect(resolveAgeTone(13, 0)).toBe('neutral');
    expect(resolveAgeTone(14, 0)).toBe('warning');
    expect(resolveAgeTone(29, 0)).toBe('danger');
  });
});

describe('buildAssigneeInitials', () => {
  it('derives initials from "Lastname, Firstname (CTR)" style names', () => {
    expect(buildAssigneeInitials('Katkar, Rahul (CTR)')).toBe('KR');
  });

  it('derives initials from plain "First Last" names', () => {
    expect(buildAssigneeInitials('Jordan John')).toBe('JJ');
  });

  it('uses the first two letters of a single-token name', () => {
    expect(buildAssigneeInitials('Somagutta')).toBe('SO');
  });

  it('returns a placeholder for blank names', () => {
    expect(buildAssigneeInitials('   ')).toBe('?');
  });
});
