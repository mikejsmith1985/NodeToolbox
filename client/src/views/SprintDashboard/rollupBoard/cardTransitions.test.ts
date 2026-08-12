// cardTransitions.test.ts — Proves the open card says where it can actually go, in board terms rather
// than Jira ones, and that a move which would land back in Unmapped says so before it is made.

import { describe, expect, it } from 'vitest';

import {
  buildCardTransitionOptions,
  describeCardTransitionOption,
  NO_TRANSITIONS_MESSAGE,
} from './cardTransitions.ts';
import { buildRenderedColumns } from './boardColumns.ts';
import type { FeatureReviewTransition } from '../featureReviewFixes.ts';
import type { BoardVocabulary } from './rollupBoardTypes.ts';

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [
    { id: 'col-working', name: 'Working', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: null }] },
    { id: 'col-qa', name: 'SL Testing', order: 1, mappings: [{ jiraStatusName: 'Ready for Testing', subStatusValue: null }] },
  ],
  updatedAt: '',
  lastSyncedAt: null,
};

const COLUMNS = buildRenderedColumns(VOCABULARY);

function buildTransition(overrides: Partial<FeatureReviewTransition> = {}): FeatureReviewTransition {
  return {
    id: '31',
    name: 'Ready for Testing',
    to: { name: 'Ready for Testing', statusCategory: { name: 'In Progress' } },
    requiredFields: [],
    screenFieldIds: [],
    ...overrides,
  } as FeatureReviewTransition;
}

describe('buildCardTransitionOptions', () => {
  it('names the board column each destination lands in, not just the Jira status', () => {
    const [option] = buildCardTransitionOptions([buildTransition()], null, VOCABULARY, COLUMNS, false);

    expect(option.toStatusName).toBe('Ready for Testing');
    expect(option.landsInColumnName).toBe('SL Testing');
  });

  it('warns that a destination no column claims would stay in Unmapped', () => {
    const [option] = buildCardTransitionOptions(
      [buildTransition({ to: { name: 'Cancelled', statusCategory: { name: 'Done' } } })],
      null,
      VOCABULARY,
      COLUMNS,
      false,
    );

    expect(option.landsInColumnName).toBeNull();
    expect(describeCardTransitionOption(option)).toContain('stays in Unmapped');
  });

  it('names the fields Jira will ask for before the move goes through', () => {
    const [option] = buildCardTransitionOptions(
      [buildTransition({
        requiredFields: [{ fieldId: 'customfield_10002', name: 'Story Points', schemaType: 'option', allowedValues: [] }],
      })],
      null,
      VOCABULARY,
      COLUMNS,
      false,
    );

    expect(describeCardTransitionOption(option)).toContain('Story Points');
  });

  it('keeps the workflow\'s own name for the step, which is what the user clicks', () => {
    const [option] = buildCardTransitionOptions(
      [buildTransition({ name: 'Send to QA' })],
      null,
      VOCABULARY,
      COLUMNS,
      false,
    );

    expect(option.transitionName).toBe('Send to QA');
  });

  it('predicts the landing column using the sub-status the issue KEEPS, not a blank one', () => {
    // A plain transition changes the status and leaves the sub-status alone, so a board that maps on
    // both would land this card somewhere the naive prediction would have got wrong.
    const subStatusVocabulary: BoardVocabulary = {
      ...VOCABULARY,
      columns: [
        { id: 'col-int', name: 'INT Testing', order: 0, mappings: [{ jiraStatusName: 'Ready for Testing', subStatusValue: 'Integration' }] },
      ],
    };
    const subStatusColumns = buildRenderedColumns(subStatusVocabulary);

    const [option] = buildCardTransitionOptions(
      [buildTransition()],
      'Integration',
      subStatusVocabulary,
      subStatusColumns,
      true,
    );

    expect(option.landsInColumnName).toBe('INT Testing');
  });

  it('returns nothing when Jira offers nothing, rather than inventing a destination', () => {
    expect(buildCardTransitionOptions([], null, VOCABULARY, COLUMNS, false)).toEqual([]);
  });
});

describe('NO_TRANSITIONS_MESSAGE', () => {
  it('names both reasons an issue can have nowhere to go', () => {
    expect(NO_TRANSITIONS_MESSAGE).toMatch(/closed/);
    expect(NO_TRANSITIONS_MESSAGE).toMatch(/permission/);
  });
});
