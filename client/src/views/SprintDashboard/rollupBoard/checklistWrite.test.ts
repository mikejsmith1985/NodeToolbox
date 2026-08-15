// checklistWrite.test.ts — Proves a ticked box round-trips back through the reader unchanged.

import { describe, expect, it } from 'vitest';

import { parseChecklistItems, type ChecklistItem } from './checklistItems.ts';
import {
  buildChecklistText,
  chooseWritableChecklistFieldId,
  describeChecklistState,
  nextChecklistState,
  withItemState,
} from './checklistWrite.ts';

/** One item, with only what a test cares about set. */
function buildItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'checklist-0', text: 'this is a test', state: 'open',
    assigneeUserId: null, headingText: null, ...overrides,
  };
}

describe('nextChecklistState', () => {
  it('cycles to do → working → done → to do', () => {
    // Three states because the third is the one people asked to see: a line that is not finished is
    // either untouched or being worked on, and a two-state checkbox cannot say which.
    expect(nextChecklistState('open')).toBe('in-progress');
    expect(nextChecklistState('in-progress')).toBe('done');
    expect(nextChecklistState('done')).toBe('open');
  });
});

describe('describeChecklistState', () => {
  it('gives every state a word, so the state never rests on a shape alone', () => {
    expect(describeChecklistState('open')).toBe('To do');
    expect(describeChecklistState('in-progress')).toBe('Working');
    expect(describeChecklistState('done')).toBe('Done');
  });
});

describe('buildChecklistText', () => {
  it('writes text the READER reads back to the same items', () => {
    // The property that matters most: a write that could not be read back would turn one tick into
    // silent corruption of the whole checklist.
    const items = [
      buildItem({ id: 'checklist-0', text: 'first', state: 'done', assigneeUserId: 'C8Q6T3' }),
      buildItem({ id: 'checklist-1', text: 'second', state: 'in-progress' }),
      buildItem({ id: 'checklist-2', text: 'third', state: 'open' }),
    ];

    const reparsed = parseChecklistItems(buildChecklistText(items));

    expect(reparsed.map((item) => [item.text, item.state, item.assigneeUserId])).toEqual([
      ['first', 'done', 'C8Q6T3'],
      ['second', 'in-progress', null],
      ['third', 'open', null],
    ]);
  });

  it('keeps a grouped checklist grouped', () => {
    const items = [
      buildItem({ id: 'checklist-0', text: 'design', headingText: 'Build' }),
      buildItem({ id: 'checklist-1', text: 'code', headingText: 'Build' }),
      buildItem({ id: 'checklist-2', text: 'sign off', headingText: 'Release' }),
    ];

    expect(parseChecklistItems(buildChecklistText(items)).map((item) => item.headingText))
      .toEqual(['Build', 'Build', 'Release']);
  });

  it('emits a repeated heading once, not once per item under it', () => {
    const items = [
      buildItem({ id: 'checklist-0', text: 'design', headingText: 'Build' }),
      buildItem({ id: 'checklist-1', text: 'code', headingText: 'Build' }),
    ];

    expect(buildChecklistText(items).split('\n').filter((line) => line.startsWith('#'))).toHaveLength(1);
  });
});

describe('withItemState', () => {
  it('changes exactly one item', () => {
    const items = [buildItem({ id: 'checklist-0' }), buildItem({ id: 'checklist-1' })];

    const changed = withItemState(items, 'checklist-1', 'done');

    expect(changed.map((item) => item.state)).toEqual(['open', 'done']);
  });
});

describe('chooseWritableChecklistFieldId', () => {
  it('prefers the field the board READS when Jira will accept writes to it', () => {
    // So the change appears where the board is already looking.
    expect(chooseWritableChecklistFieldId(
      ['customfield_1', 'customfield_2'], ['customfield_1', 'customfield_2'], 'customfield_2',
    )).toBe('customfield_2');
  });

  it('falls back to another checklist field when the readable one is not editable', () => {
    // The real shape on this instance: the app's object dump is readable and could never be written.
    expect(chooseWritableChecklistFieldId(
      ['customfield_2'], ['customfield_1', 'customfield_2'], 'customfield_1',
    )).toBe('customfield_2');
  });

  it('answers null when the edit screen offers no checklist field at all', () => {
    // Honest: the board can read this checklist and cannot write it, and says exactly that.
    expect(chooseWritableChecklistFieldId(['summary'], ['customfield_1'], 'customfield_1')).toBeNull();
  });
});
