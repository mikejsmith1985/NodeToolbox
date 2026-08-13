// checklistItems.test.ts — Proves a Smart Checklist becomes readable items, and that an unfamiliar
// syntax degrades into plain text rather than into an empty card.

import { describe, expect, it } from 'vitest';

import {
  findChecklistFieldId,
  parseChecklistItems,
  summarizeChecklist,
} from './checklistItems.ts';

describe('parseChecklistItems', () => {
  it('reads the plain item the user typed in Jira', () => {
    // The real case from GH #363: one hand-made item with a mention.
    const items = parseChecklistItems('- [ ] this is a test @C8Q6T3');

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('this is a test');
    expect(items[0].state).toBe('open');
    expect(items[0].assigneeUserId).toBe('C8Q6T3');
  });

  it('reads all three states', () => {
    const items = parseChecklistItems('- [ ] open\n- [>] doing\n- [x] finished');

    expect(items.map((item) => item.state)).toEqual(['open', 'in-progress', 'done']);
  });

  it('accepts the other in-progress markers the app writes', () => {
    expect(parseChecklistItems('- [~] a')[0].state).toBe('in-progress');
    expect(parseChecklistItems('- [/] a')[0].state).toBe('in-progress');
  });

  it('treats an unrecognised marker as not started rather than dropping the line', () => {
    const items = parseChecklistItems('- [?] something odd');

    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('open');
  });

  it('carries a heading onto the items beneath it, without making a card for the heading', () => {
    const items = parseChecklistItems('# Setup\n- [ ] first\n- [x] second\n# Teardown\n- [ ] third');

    expect(items).toHaveLength(3);
    expect(items[0].headingText).toBe('Setup');
    expect(items[2].headingText).toBe('Teardown');
  });

  it('takes the mention out of the text, so the owner is not printed twice', () => {
    const items = parseChecklistItems('- [ ] review the mapping @jsmith please');

    expect(items[0].text).toBe('review the mapping please');
    expect(items[0].assigneeUserId).toBe('jsmith');
  });

  it('keeps a line it cannot parse as plain item text', () => {
    // The syntax belongs to a third-party app; an unreadable checklist should look odd, never empty.
    const items = parseChecklistItems('just some free text with no marker at all');

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('just some free text with no marker at all');
  });

  it('reads nothing from an empty or absent field', () => {
    expect(parseChecklistItems('')).toEqual([]);
    expect(parseChecklistItems(null)).toEqual([]);
    expect(parseChecklistItems(undefined)).toEqual([]);
    expect(parseChecklistItems('   \n  \n')).toEqual([]);
  });

  it('gives every item a stable id, since checklist items have none of their own', () => {
    const items = parseChecklistItems('- [ ] a\n- [ ] b');

    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });
});

describe('summarizeChecklist', () => {
  it('counts what is done against the whole list', () => {
    expect(summarizeChecklist(parseChecklistItems('- [x] a\n- [ ] b\n- [>] c')))
      .toEqual({ completedCount: 1, totalCount: 3 });
  });

  it('says nothing at all when there is no checklist', () => {
    expect(summarizeChecklist([])).toBeNull();
  });

  it('counts in-progress as unfinished, because it is', () => {
    expect(summarizeChecklist(parseChecklistItems('- [>] a'))?.completedCount).toBe(0);
  });
});

describe('findChecklistFieldId', () => {
  it('prefers a field actually NAMED checklist over one that merely comes from the app', () => {
    const fieldId = findChecklistFieldId([
      { id: 'customfield_1', name: 'Something Else', schema: { custom: 'com.okapya.jira.checklist:checklist' } },
      { id: 'customfield_2', name: 'Smart Checklist', schema: { custom: 'other' } },
    ]);

    expect(fieldId).toBe('customfield_2');
  });

  it('falls back to the app-provided field when nothing is named checklist', () => {
    expect(findChecklistFieldId([
      { id: 'customfield_1', name: 'Steps', schema: { custom: 'com.okapya.jira.checklist:checklist' } },
    ])).toBe('customfield_1');
  });

  it('returns nothing when this instance has no checklist field, rather than guessing an id', () => {
    expect(findChecklistFieldId([{ id: 'customfield_1', name: 'Story Points' }])).toBeNull();
    expect(findChecklistFieldId([])).toBeNull();
  });
});
