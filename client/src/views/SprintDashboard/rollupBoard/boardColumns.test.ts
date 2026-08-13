// boardColumns.test.ts — Proves the team's own column names resolve to real Jira states, and that
// nothing is ever placed by guesswork.
//
// The board exists because status names do not describe reality. That only helps if a column means
// exactly one Jira state and an item nobody claimed is VISIBLY unclaimed rather than quietly filed
// somewhere plausible.

import { describe, expect, it } from 'vitest';

import { buildRenderedColumns, resolveColumnIdForItem, validateVocabulary } from './boardColumns.ts';
import { UNMAPPED_COLUMN_ID, type BoardVocabulary } from './rollupBoardTypes.ts';

/** A two-column vocabulary in a team's own words, each mapped to a status + sub-status pair. */
function buildVocabulary(): BoardVocabulary {
  return {
    teamProfileId: 'team-a',
    columns: [
      {
        id: 'col-dev',
        name: 'Being coded',
        order: 0,
        mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }],
      },
      {
        id: 'col-sl',
        name: 'Waiting on SL test',
        order: 1,
        mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' }],
      },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
    lastSyncedAt: null,
  };
}

describe('resolveColumnIdForItem', () => {
  it('places an item in the column claiming its exact status and sub-status pair', () => {
    expect(resolveColumnIdForItem('In Progress', 'Dev Complete', buildVocabulary(), true)).toBe('col-sl');
  });

  it('tells two columns apart by sub-status alone when their Jira status is identical', () => {
    const vocabulary = buildVocabulary();

    expect(resolveColumnIdForItem('In Progress', 'Dev In Progress', vocabulary, true)).toBe('col-dev');
    expect(resolveColumnIdForItem('In Progress', 'Dev Complete', vocabulary, true)).toBe('col-sl');
  });

  it('sends an unclaimed status combination to Unmapped instead of the nearest status-only column', () => {
    // "Code Review" is a real state nobody has named yet. Filing it under a column that merely shares
    // its Jira status would hide precisely the item whose state is most in question.
    expect(resolveColumnIdForItem('In Progress', 'Code Review', buildVocabulary(), true)).toBe(UNMAPPED_COLUMN_ID);
  });

  it('refuses to part-match an item with no sub-status against a column that requires one', () => {
    expect(resolveColumnIdForItem('In Progress', null, buildVocabulary(), true)).toBe(UNMAPPED_COLUMN_ID);
  });

  it('matches on status alone when this instance has no sub-status field', () => {
    const statusOnlyVocabulary: BoardVocabulary = {
      ...buildVocabulary(),
      columns: [{ id: 'col-dev', name: 'Being coded', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: null }] }],
    };

    expect(resolveColumnIdForItem('In Progress', null, statusOnlyVocabulary, false)).toBe('col-dev');
  });

  it('ignores a sub-status value when the instance has no sub-status field to trust', () => {
    const statusOnlyVocabulary: BoardVocabulary = {
      ...buildVocabulary(),
      columns: [{ id: 'col-dev', name: 'Being coded', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: null }] }],
    };

    expect(resolveColumnIdForItem('In Progress', 'Whatever', statusOnlyVocabulary, false)).toBe('col-dev');
  });

  it('compares names case-insensitively, since Jira varies its casing between screens', () => {
    expect(resolveColumnIdForItem('in progress', 'dev complete', buildVocabulary(), true)).toBe('col-sl');
  });

  it('ignores surrounding whitespace on both sides of the comparison', () => {
    expect(resolveColumnIdForItem('  In Progress  ', ' Dev Complete ', buildVocabulary(), true)).toBe('col-sl');
  });

  it('places everything in Unmapped when the team has defined no columns yet, and still resolves', () => {
    const emptyVocabulary: BoardVocabulary = { ...buildVocabulary(), columns: [] };

    expect(resolveColumnIdForItem('In Progress', 'Dev Complete', emptyVocabulary, true)).toBe(UNMAPPED_COLUMN_ID);
  });

  it('never places an item in a column that has been defined but not yet mapped', () => {
    const unmappedColumnVocabulary: BoardVocabulary = {
      ...buildVocabulary(),
      columns: [{ id: 'col-new', name: 'Somewhere new', order: 0, mappings: [] }],
    };

    expect(resolveColumnIdForItem('In Progress', 'Dev Complete', unmappedColumnVocabulary, true)).toBe(UNMAPPED_COLUMN_ID);
  });
});

describe('validateVocabulary', () => {
  it('accepts a well-formed vocabulary', () => {
    expect(validateVocabulary(buildVocabulary()).isValid).toBe(true);
  });

  it('refuses two columns claiming the same Jira state, naming both', () => {
    const vocabulary = buildVocabulary();
    vocabulary.columns[1].mappings = [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }];

    const validation = validateVocabulary(vocabulary);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0].kind).toBe('duplicate-mapping');
    expect(validation.errors[0].columnIds).toEqual(['col-dev', 'col-sl']);
  });

  it('refuses two columns sharing a name, whatever their casing', () => {
    const vocabulary = buildVocabulary();
    vocabulary.columns[1].name = 'BEING CODED';

    const validation = validateVocabulary(vocabulary);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((error) => error.kind === 'duplicate-name')).toBe(true);
  });

  it('refuses a column whose name is only whitespace', () => {
    const vocabulary = buildVocabulary();
    vocabulary.columns[0].name = '   ';

    expect(validateVocabulary(vocabulary).errors.some((error) => error.kind === 'blank-name')).toBe(true);
  });

  it('accepts a column that is defined but not yet mapped — it simply holds nothing', () => {
    const vocabulary = buildVocabulary();
    vocabulary.columns[1].mappings = [];

    expect(validateVocabulary(vocabulary).isValid).toBe(true);
  });

  it('accepts two unmapped columns, since neither claims a Jira state', () => {
    const vocabulary = buildVocabulary();
    vocabulary.columns[0].mappings = [];
    vocabulary.columns[1].mappings = [];

    expect(validateVocabulary(vocabulary).isValid).toBe(true);
  });
});

describe('buildRenderedColumns', () => {
  it('renders the team columns in their chosen order', () => {
    const rendered = buildRenderedColumns(buildVocabulary());

    expect(rendered.slice(0, 2).map((column) => column.name)).toEqual(['Being coded', 'Waiting on SL test']);
  });

  it('normalises out-of-sequence order values without treating them as an error', () => {
    const vocabulary = buildVocabulary();
    vocabulary.columns[0].order = 5;
    vocabulary.columns[1].order = 9;

    const rendered = buildRenderedColumns(vocabulary);

    expect(rendered.slice(0, 2).map((column) => column.order)).toEqual([0, 1]);
  });

  it('always appends the Unmapped column last, even when it will hold nothing', () => {
    const rendered = buildRenderedColumns(buildVocabulary());

    expect(rendered[rendered.length - 1].id).toBe(UNMAPPED_COLUMN_ID);
    expect(rendered[rendered.length - 1].isUnmappedColumn).toBe(true);
  });

  it('still renders the Unmapped column when the team has defined no columns at all', () => {
    const rendered = buildRenderedColumns({ ...buildVocabulary(), columns: [] });

    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe(UNMAPPED_COLUMN_ID);
  });
});

describe('a column claims several Jira states, like a Jira board column', () => {
  /** "Being coded" covers two sub-statuses, which is the whole point of the multi-state model. */
  function buildMultiStateVocabulary(): BoardVocabulary {
    return {
      teamProfileId: 'team-a',
      columns: [{
        id: 'col-dev',
        name: 'Being coded',
        order: 0,
        mappings: [
          { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' },
          { jiraStatusName: 'In Progress', subStatusValue: 'Code Review' },
        ],
      }],
      updatedAt: '',
      lastSyncedAt: null,
    };
  }

  it('places an item matching any one of a column\'s claimed states', () => {
    const vocabulary = buildMultiStateVocabulary();

    expect(resolveColumnIdForItem('In Progress', 'Dev In Progress', vocabulary, true)).toBe('col-dev');
    expect(resolveColumnIdForItem('In Progress', 'Code Review', vocabulary, true)).toBe('col-dev');
  });

  it('still sends a state the column does NOT claim to Unmapped', () => {
    expect(resolveColumnIdForItem('In Progress', 'Dev Complete', buildMultiStateVocabulary(), true))
      .toBe(UNMAPPED_COLUMN_ID);
  });

  it('refuses two DIFFERENT columns claiming the same state', () => {
    const vocabulary = buildMultiStateVocabulary();
    vocabulary.columns.push({
      id: 'col-other',
      name: 'Somewhere else',
      order: 1,
      mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Code Review' }],
    });

    const validation = validateVocabulary(vocabulary);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0].columnIds).toEqual(['col-dev', 'col-other']);
  });

  it('accepts one column claiming many states — that is not a conflict', () => {
    expect(validateVocabulary(buildMultiStateVocabulary()).isValid).toBe(true);
  });

  it('lists every claimed state on the rendered column, so the header can show them', () => {
    const [renderedColumn] = buildRenderedColumns(buildMultiStateVocabulary());

    expect(renderedColumn.mappings).toHaveLength(2);
  });
});

describe('one column claiming two DIFFERENT statuses', () => {
  /** The GH #363 ask: "Done" and "Accepted" should both land in the column labelled Accepted. */
  const TWO_STATUS_VOCABULARY: BoardVocabulary = {
    teamProfileId: 'team-a',
    columns: [{
      id: 'col-accepted',
      name: 'Accepted',
      order: 0,
      mappings: [
        { jiraStatusName: 'Accepted', subStatusValue: null },
        { jiraStatusName: 'Done', subStatusValue: null },
      ],
    }],
    updatedAt: '',
    lastSyncedAt: null,
  };

  it('places an issue in either status into the one column', () => {
    expect(resolveColumnIdForItem('Accepted', null, TWO_STATUS_VOCABULARY, true)).toBe('col-accepted');
    expect(resolveColumnIdForItem('Done', null, TWO_STATUS_VOCABULARY, true)).toBe('col-accepted');
  });

  it('still sends a status nobody claimed to Unmapped, so the guarantee is unchanged', () => {
    expect(resolveColumnIdForItem('Cancelled', null, TWO_STATUS_VOCABULARY, true)).toBe(UNMAPPED_COLUMN_ID);
  });
});
