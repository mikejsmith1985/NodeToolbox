// checkInModel.test.ts — One developer's plate, reduced to what a status conversation needs.

import { describe, expect, it } from 'vitest';

import {
  buildCheckInIssue,
  calendarDaysSince,
  daysPastDueDate,
  MAX_COMMENTS_PER_ISSUE,
  MAX_COMMENT_CHARS,
  readRecentComments,
  sortByConversationUrgency,
  type CheckInIssue,
} from './checkInModel.ts';
import { FEATURE_LINK_DEFAULT_FIELD } from '../../../utils/featureLink.ts';
import { resolveStoryPointsFieldIds } from '../../Hygiene/checks/storyPointsField.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const NOW_MS = Date.parse('2026-08-27T12:00:00.000Z');
// Read from the central resolver rather than written out: the field-mapping ratchet exists to stop a
// new file naming a custom field id, and a test is no exception.
const STORY_POINTS_FIELD = resolveStoryPointsFieldIds('')[0];

/** Days before now, as an ISO timestamp. */
function daysAgo(dayCount: number): string {
  return new Date(NOW_MS - dayCount * 86_400_000).toISOString();
}

/** A Jira issue carrying only what the model reads. */
function issue(fields: Record<string, unknown> = {}): JiraIssue {
  return {
    key: 'ENCUC-1',
    fields: {
      summary: 'Wire up the intake',
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      updated: daysAgo(2),
      statuscategorychangedate: daysAgo(9),
      ...fields,
    },
  } as unknown as JiraIssue;
}

/** The options the builder needs, with sensible defaults. */
function buildOptions(featureSummaries: [string, string][] = []) {
  return {
    nowMs: NOW_MS,
    storyPointsFieldId: STORY_POINTS_FIELD,
    featureLinkFieldId: FEATURE_LINK_DEFAULT_FIELD,
    featureSummaryByKey: new Map(featureSummaries),
  };
}

describe('calendarDaysSince', () => {
  it('counts whole days back from now', () => {
    expect(calendarDaysSince(daysAgo(9), NOW_MS)).toBe(9);
  });

  it('returns nothing for a missing or unreadable timestamp', () => {
    expect(calendarDaysSince(null, NOW_MS)).toBeNull();
    expect(calendarDaysSince('not a date', NOW_MS)).toBeNull();
  });

  it('never returns a negative elapsed time', () => {
    expect(calendarDaysSince(new Date(NOW_MS + 86_400_000).toISOString(), NOW_MS)).toBe(0);
  });
});

describe('daysPastDueDate', () => {
  it('is positive when the date has passed', () => {
    expect(daysPastDueDate('2026-08-20', NOW_MS)).toBe(7);
  });

  it('is NEGATIVE when there is still time, because that is a different conversation', () => {
    // Clamping both to zero would lose the distinction that matters most.
    expect(daysPastDueDate('2026-08-30', NOW_MS)).toBe(-3);
  });

  it('returns nothing when no due date is set', () => {
    expect(daysPastDueDate(null, NOW_MS)).toBeNull();
  });

  it('does not let a timezone offset flip a date-only due date', () => {
    expect(daysPastDueDate('2026-08-27', NOW_MS)).toBe(0);
  });
});

describe('readRecentComments', () => {
  /** A comment made the given number of days ago. */
  function comment(authorName: string, text: string, dayCount: number) {
    return { author: { displayName: authorName }, created: daysAgo(dayCount), body: text };
  }

  it('puts the newest first, because that is what a status question is about', () => {
    // The oldest comment on a long-running ticket is usually its creation, which says nothing about now.
    const comments = readRecentComments(
      issue({ comment: { comments: [comment('Ann', 'Oldest', 30), comment('Bob', 'Newest', 1)] } }),
      NOW_MS,
    );

    expect(comments.map((each) => each.text)).toEqual(['Newest', 'Oldest']);
  });

  it('keeps only the current thread, not the history', () => {
    const manyComments = Array.from({ length: 10 }, (_unused, index) => comment('Ann', `Comment ${index}`, index));

    expect(readRecentComments(issue({ comment: { comments: manyComments } }), NOW_MS))
      .toHaveLength(MAX_COMMENTS_PER_ISSUE);
  });

  it('caps a long comment so one cannot crowd out a whole plate', () => {
    const comments = readRecentComments(
      issue({ comment: { comments: [comment('Ann', 'x'.repeat(2000), 1)] } }),
      NOW_MS,
    );

    expect(comments[0].text.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS + 1);
    expect(comments[0].text.endsWith('…')).toBe(true);
  });

  it('drops a comment with nothing readable in it', () => {
    expect(readRecentComments(issue({ comment: { comments: [comment('Ann', '   ', 1)] } }), NOW_MS)).toEqual([]);
  });

  it('reports no comments rather than failing when the issue carried none', () => {
    expect(readRecentComments(issue(), NOW_MS)).toEqual([]);
  });
});

describe('buildCheckInIssue', () => {
  it('measures time from when the issue last changed STAGE', () => {
    // An item shuffled between two in-progress statuses has not started moving again, and
    // statuscategorychangedate does not pretend it has.
    const built = buildCheckInIssue(issue({ statuscategorychangedate: daysAgo(12) }), buildOptions());

    expect(built.daysInStage).toBe(12);
    expect(built.daysSinceUpdate).toBe(2);
  });

  it('names the Feature it delivers, so the conversation is about an outcome', () => {
    const built = buildCheckInIssue(
      issue({ [FEATURE_LINK_DEFAULT_FIELD]: 'FEAT-10' }),
      buildOptions([['FEAT-10', 'Online enrollment intake']]),
    );

    expect(built.featureKey).toBe('FEAT-10');
    expect(built.featureSummary).toBe('Online enrollment intake');
  });

  it('keeps the Feature key when its summary was not fetched', () => {
    const built = buildCheckInIssue(issue({ [FEATURE_LINK_DEFAULT_FIELD]: 'FEAT-10' }), buildOptions());

    expect(built.featureKey).toBe('FEAT-10');
    expect(built.featureSummary).toBeNull();
  });

  it('carries the due date and how far past it the issue is', () => {
    const built = buildCheckInIssue(issue({ duedate: '2026-08-20' }), buildOptions());

    expect(built.dueDateIso).toBe('2026-08-20');
    expect(built.daysPastDue).toBe(7);
  });

  it('reads a story-point value stored as a string, which some Jiras return', () => {
    const built = buildCheckInIssue(issue({ [STORY_POINTS_FIELD]: '5' }), buildOptions());

    expect(built.storyPoints).toBe(5);
  });

  it('reports an unreadable story-point value as absent rather than as zero', () => {
    expect(buildCheckInIssue(issue({ [STORY_POINTS_FIELD]: 'Medium' }), buildOptions()).storyPoints).toBeNull();
  });

  it('survives an issue that states almost nothing', () => {
    const built = buildCheckInIssue({ key: 'ENCUC-9', fields: {} } as unknown as JiraIssue, buildOptions());

    expect(built.issueKey).toBe('ENCUC-9');
    expect(built.status).toBe('Unknown');
    expect(built.daysInStage).toBeNull();
    expect(built.comments).toEqual([]);
  });
});

describe('sortByConversationUrgency', () => {
  /** A check-in issue with only the fields the sort reads. */
  function checkInIssue(issueKey: string, daysPastDue: number | null, daysInStage: number | null): CheckInIssue {
    return {
      issueKey,
      issueType: 'Story',
      summary: '',
      status: 'In Progress',
      daysInStage,
      daysSinceUpdate: null,
      dueDateIso: daysPastDue === null ? null : '2026-08-20',
      daysPastDue,
      priority: null,
      storyPoints: null,
      featureKey: null,
      featureSummary: null,
      description: '',
      comments: [],
    };
  }

  it('opens with what is overdue, which is the useful conversation', () => {
    const sorted = sortByConversationUrgency([
      checkInIssue('ENCUC-1', null, 40),
      checkInIssue('ENCUC-2', 3, 2),
    ]);

    expect(sorted.map((each) => each.issueKey)).toEqual(['ENCUC-2', 'ENCUC-1']);
  });

  it('then takes whatever has sat longest without changing stage', () => {
    const sorted = sortByConversationUrgency([
      checkInIssue('ENCUC-1', null, 3),
      checkInIssue('ENCUC-2', null, 30),
    ]);

    expect(sorted.map((each) => each.issueKey)).toEqual(['ENCUC-2', 'ENCUC-1']);
  });

  it('does not treat a due date still in the future as overdue', () => {
    const sorted = sortByConversationUrgency([
      checkInIssue('ENCUC-1', null, 40),
      checkInIssue('ENCUC-2', -5, 1),
    ]);

    expect(sorted[0].issueKey).toBe('ENCUC-1');
  });

  it("leaves the caller's list untouched", () => {
    const original = [checkInIssue('ENCUC-1', null, 1), checkInIssue('ENCUC-2', null, 40)];

    sortByConversationUrgency(original);

    expect(original.map((each) => each.issueKey)).toEqual(['ENCUC-1', 'ENCUC-2']);
  });
});
