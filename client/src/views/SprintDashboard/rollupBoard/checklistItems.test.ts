// checklistItems.test.ts — Proves a Smart Checklist becomes readable items, and that an unfamiliar
// syntax degrades into plain text rather than into an empty card.

import { describe, expect, it } from 'vitest';

import {
  chooseChecklistFieldByValue,
  findChecklistFieldId,
  listChecklistFieldIds,
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
    expect(parseChecklistItems('- [>] a')[0].state).toBe('in-progress');
    expect(parseChecklistItems('- [/] a')[0].state).toBe('in-progress');
  });

  it('reads a tilde as SKIPPED, which the app has as a status of its own', () => {
    // Previously read as in-progress, so an item somebody deliberately set aside came back looking
    // like work in flight — the opposite of what it says.
    expect(parseChecklistItems('- [~] a')[0].state).toBe('skipped');
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

// ── The formats this Jira really stores ──
//
// Taken verbatim from the Board setup diagnostic on ENCUC-2311. Three fields matched "checklist" and
// they hold the same single item three different ways — which is why choosing by name chose wrong.

/** customfield_10600, "Smart Checklist": the app's own object graph, rendered by toString(). */
const SMART_CHECKLIST_DUMP = ['Checklist(id=88538, issueId=305985, _items=[Item(id=43628, checklistId=88538,'
  + ' value=this is a test @C8Q6T3, rank=0, status=Status(id=1, rank=0, statusState=UNCHECKED, name=TO DO,'
  + ' color=GRAY, default=true, global=true, projectIds=[]), quotes=[], assignees=[Assignee(id=100,'
  + ' userName=C8Q6T3, displayName=C8Q6T3)], history=History(id=69695, itemId=43628, checklistId=88538,'
  + ' type=ITEM_CREATED, from=, to=TO DO, date=2026-08-13 12:28:21.985, user=Smith, Michael  (CTR)),'
  + ' mandatory=false, description=null, weight=null, removeStatus=null)])'];

/** customfield_10252, "Checklists": the same item as readable text. */
const CHECKLIST_TEXT = '- this is a test @C8Q6T3\n';

/** customfield_10601, "Smart Checklist Progress": a summary, not items. */
const CHECKLIST_PROGRESS = '0/1';

describe('the Smart Checklist app\'s own stored value', () => {
  it('reads the item out of the object dump, wrapped in its array', () => {
    const items = parseChecklistItems(SMART_CHECKLIST_DUMP);

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('this is a test');
    expect(items[0].assigneeUserId).toBe('C8Q6T3');
  });

  it('reads UNCHECKED as not started', () => {
    expect(parseChecklistItems(SMART_CHECKLIST_DUMP)[0].state).toBe('open');
  });

  it('reads CHECKED as done', () => {
    const doneDump = SMART_CHECKLIST_DUMP[0].replace('statusState=UNCHECKED', 'statusState=CHECKED');

    expect(parseChecklistItems([doneDump])[0].state).toBe('done');
  });

  it('prefers the status NAME where it says more than the checkbox can', () => {
    // UNCHECKED cannot express "started"; the status name is the only place that lives.
    const inProgressDump = SMART_CHECKLIST_DUMP[0].replace('name=TO DO', 'name=IN PROGRESS');

    expect(parseChecklistItems([inProgressDump])[0].state).toBe('in-progress');
  });

  it('reads several items without merging them into one', () => {
    const twoItems = ['Checklist(id=1, _items=[Item(id=1, value=first thing, rank=0,'
      + ' status=Status(statusState=CHECKED, name=DONE)), Item(id=2, value=second thing, rank=1,'
      + ' status=Status(statusState=UNCHECKED, name=TO DO))])'];

    const items = parseChecklistItems(twoItems);
    expect(items.map((item) => item.text)).toEqual(['first thing', 'second thing']);
    expect(items.map((item) => item.state)).toEqual(['done', 'open']);
  });
});

describe('chooseChecklistFieldByValue — the field is chosen by what it holds', () => {
  const ISSUE_FIELDS = {
    customfield_10600: SMART_CHECKLIST_DUMP,
    customfield_10601: CHECKLIST_PROGRESS,
    customfield_10252: CHECKLIST_TEXT,
  };

  it('never chooses the progress field, which holds a summary rather than items', () => {
    // "0/1" would parse to one meaningless item under a forgiving markdown reader, and — being a tie
    // on count with the real checklist — could then win. A bare done/total is recognised and rejected.
    expect(chooseChecklistFieldByValue(['customfield_10601'], ISSUE_FIELDS)).toBeNull();
    expect(chooseChecklistFieldByValue(
      ['customfield_10601', 'customfield_10600'], ISSUE_FIELDS,
    )).toBe('customfield_10600');
  });

  it('chooses a field that yields items over one that yields none', () => {
    expect(chooseChecklistFieldByValue(
      ['customfield_99999', 'customfield_10252'], ISSUE_FIELDS,
    )).toBe('customfield_10252');
  });

  it('chooses nothing when no candidate yields anything, rather than picking the first', () => {
    expect(chooseChecklistFieldByValue(['customfield_99999'], {})).toBeNull();
    expect(chooseChecklistFieldByValue([], ISSUE_FIELDS)).toBeNull();
  });
});

describe('listChecklistFieldIds', () => {
  it('keeps every checklist-ish field, because which one is readable depends on the value', () => {
    const fieldIds = listChecklistFieldIds([
      { id: 'customfield_10600', name: 'Smart Checklist', schema: { custom: 'rw-smart-checklist-biz:x' } },
      { id: 'customfield_10601', name: 'Smart Checklist Progress' },
      { id: 'customfield_10252', name: 'Checklists' },
      { id: 'customfield_1', name: 'Story Points' },
    ]);

    expect(fieldIds).toEqual(['customfield_10600', 'customfield_10601', 'customfield_10252']);
  });
});

describe('an empty Smart Checklist', () => {
  // Straight off a real card in GH #363: the app stores an empty checklist as its own object graph
  // with nothing in it. Nothing here says "Item(" or "value=", so the dump reader used to decline it
  // and the markdown reader turned the line of Java into a checklist item.
  const EMPTY_DUMP = ['Checklist(id=84509, issueId=302462, _items=[])'];

  it('is recognised as a checklist, not as one item of prose', () => {
    expect(parseChecklistItems(EMPTY_DUMP)).toEqual([]);
  });

  it('reports no progress at all rather than "0 of 1"', () => {
    expect(summarizeChecklist(parseChecklistItems(EMPTY_DUMP))).toBeNull();
  });

  it('is not chosen as the field to read when another field holds real items', () => {
    expect(chooseChecklistFieldByValue(['customfield_10600', 'customfield_10252'], {
      customfield_10600: EMPTY_DUMP,
      customfield_10252: '- [ ] a real item',
    })).toBe('customfield_10252');
  });

  it('still reads a checklist that has items, so the wider match costs nothing', () => {
    expect(parseChecklistItems(SMART_CHECKLIST_DUMP)).toHaveLength(1);
  });
});
