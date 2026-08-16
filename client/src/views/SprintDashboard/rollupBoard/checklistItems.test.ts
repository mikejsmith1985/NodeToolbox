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

  it('reads the four states the app documents', () => {
    // Straight from Smart Checklist's own formatting guide: "- item todo, + item done,
    // ~ item in progress, x item cancelled". Every one of these was previously guessed instead of
    // looked up, and every guess was wrong.
    const items = parseChecklistItems('- todo\n+ finished\n~ doing\nx dropped');

    expect(items.map((item) => item.state)).toEqual(['open', 'done', 'in-progress', 'skipped']);
  });

  it('reads a tilde as IN PROGRESS, which is what the app means by it', () => {
    // Read as "skipped" for two releases, so work actually in flight showed as deliberately set
    // aside — and the board then refused to write the state it had misread.
    expect(parseChecklistItems('~ a')[0].state).toBe('in-progress');
  });

  it('reads a bare x as cancelled, not as a checkbox', () => {
    expect(parseChecklistItems('x a')[0].state).toBe('skipped');
  });

  it('reads a CUSTOM status by name, which is what the brackets are actually for', () => {
    // `- [IN QA] Item text` in the app's guide. The board read the brackets as a single-character
    // checkbox, which is why it wrote `- [x]` and the app read that as a custom status called "x".
    expect(parseChecklistItems('- [IN PROGRESS] a')[0].state).toBe('in-progress');
    expect(parseChecklistItems('+ [PASSED] a')[0].state).toBe('done');
  });

  it('falls back to the marker when a custom status means nothing here', () => {
    // Exactly what the app itself does with a status it cannot resolve.
    expect(parseChecklistItems('+ [SOME TEAM THING] a')[0].state).toBe('done');
  });

  it('keeps the text of an item whose marker it does not recognise', () => {
    const items = parseChecklistItems('? something odd');

    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('open');
  });

  it('carries a heading onto the items beneath it, without making a card for the heading', () => {
    const items = parseChecklistItems('# Setup\n- first\n+ second\n# Teardown\n- third');

    expect(items).toHaveLength(3);
    expect(items[0].headingText).toBe('Setup');
    expect(items[2].headingText).toBe('Teardown');
  });

  it('takes the mention out of the text, so the owner is not printed twice', () => {
    const items = parseChecklistItems('- review the mapping @jsmith please');

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
    expect(summarizeChecklist(parseChecklistItems('+ a\n- b\n~ c')))
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

  it('reads the item’s CURRENT status from its latest transition, not from its status definition', () => {
    // Proved against the live instance: an item sitting in IN PROGRESS still stores
    // `status=Status(… name=TO DO, default=true …)`. That group is the app's status DEFINITION and
    // does not move when the item does — reading it produced a board that confidently disagreed with
    // Jira, which is worse than one admitting it does not know.
    const movedDump = SMART_CHECKLIST_DUMP[0].replace(
      'type=ITEM_CREATED, from=, to=TO DO, date=2026-08-13 12:28:21.985',
      'type=ITEM_CREATED, from=, to=TO DO, date=2026-08-13 12:28:21.985, user=x), '
        + 'history=History(id=2, type=STATUS_CHANGED, from=TO DO, to=IN PROGRESS, '
        + 'date=2026-08-16 09:15:00.000',
    );

    expect(parseChecklistItems([movedDump])[0].state).toBe('in-progress');
  });

  it('takes the LATEST transition, whichever order the app wrote them in', () => {
    // Chosen by date rather than by position: a list read backwards would report the status an item
    // was in when it was created, which is the bug being fixed rather than a fix for it.
    const outOfOrder = ['Checklist(id=1, _items=[Item(id=1, value=a, rank=0, '
      + 'status=Status(name=TO DO, statusState=UNCHECKED, default=true), '
      + 'history=History(id=2, from=TO DO, to=DONE, date=2026-08-16 09:15:00.000), '
      + 'history=History(id=1, from=, to=TO DO, date=2026-08-13 12:28:21.985))])'];

    expect(parseChecklistItems(outOfOrder)[0].state).toBe('done');
  });

  it('falls back to the status definition when the item has no history at all', () => {
    const noHistory = ['Checklist(id=1, _items=[Item(id=1, value=a, rank=0, '
      + 'status=Status(name=DONE, statusState=CHECKED))])'];

    expect(parseChecklistItems(noHistory)[0].state).toBe('done');
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

describe('the app dump — reading a status that is not simply ticked or unticked', () => {
  /** One item block in the app's own dump format. */
  function buildDump(statusFragment: string): string {
    return `["Checklist(id=1, issueId=2, _items=[Item(id=43628, value=this is a test @C8Q6T3, `
      + `rank=0, ${statusFragment}, assignees=[Assignee(userName=C8Q6T3)])], done=0)"]`;
  }

  it('reads IN PROGRESS, which statusState alone calls UNCHECKED', () => {
    // The bug this replaces: an item set to In progress in Jira came back to the board as To do,
    // because the only field that distinguishes them is the display NAME.
    expect(parseChecklistItems(buildDump('status=Status(id=2, statusState=UNCHECKED, name=IN PROGRESS)'))[0].state)
      .toBe('in-progress');
  });

  it('still reaches the name when the status carries a nested group of its own', () => {
    // A regex cannot: `[^)]*?` stops at the first closing bracket, so anything nested hid the name
    // and the reader fell back to UNCHECKED — silently, and for every item.
    const nested = 'status=Status(id=2, colour=Colour(r=1, g=2), statusState=UNCHECKED, name=IN PROGRESS)';

    expect(parseChecklistItems(buildDump(nested))[0].state).toBe('in-progress');
  });

  it('reads a custom status name it has never seen before', () => {
    // Display strings from a third-party app. An exact-match list turns every unfamiliar one into
    // "not started", which is the quietest possible way to be wrong.
    expect(parseChecklistItems(buildDump('status=Status(id=9, statusState=UNCHECKED, name=In Progress (dev))'))[0].state)
      .toBe('in-progress');
  });

  it('still reads TO DO as not started', () => {
    expect(parseChecklistItems(buildDump('status=Status(id=1, statusState=UNCHECKED, name=TO DO)'))[0].state)
      .toBe('open');
  });

  it('still reads DONE as finished', () => {
    expect(parseChecklistItems(buildDump('status=Status(id=3, statusState=CHECKED, name=DONE)'))[0].state)
      .toBe('done');
  });

  it('reads SKIPPED as its own state, not as not-started', () => {
    expect(parseChecklistItems(buildDump('status=Status(id=4, statusState=UNCHECKED, name=SKIPPED)'))[0].state)
      .toBe('skipped');
  });

  it('never lets the item TEXT decide the state', () => {
    // "progress" in somebody's checklist wording must not set the item to In progress.
    const dump = `["Checklist(id=1, _items=[Item(id=1, value=review the progress report, rank=0, `
      + `status=Status(id=1, statusState=UNCHECKED, name=TO DO))], done=0)"]`;

    expect(parseChecklistItems(dump)[0].state).toBe('open');
  });

  it('falls back to statusState when the item carries no status group at all', () => {
    const dump = '["Checklist(id=1, _items=[Item(id=1, value=a, rank=0, statusState=CHECKED)], done=1)"]';

    expect(parseChecklistItems(dump)[0].state).toBe('done');
  });
});
