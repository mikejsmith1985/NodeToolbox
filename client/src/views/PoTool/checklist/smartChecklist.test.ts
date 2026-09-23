// smartChecklist.test.ts — Ticking a checklist item means writing the WHOLE field back, so the load-bearing
// property is that nothing else changes. These prove the Epic's own DoR/DoD survives being ticked.

import { describe, expect, it } from 'vitest';

import {
  applyChecklistCompletions,
  countCompletedItems,
  listOpenItems,
  parseSmartChecklist,
} from './smartChecklist.ts';

/** The team's real checklist shape: two top-level definitions, nested group headers, one-line items. */
const EPIC_CHECKLIST_TEXT = [
  '# 🧰 Definition of Ready (DoR)',
  '## 🎯 Business Readiness',
  '- [ ] Business objective, success criteria, and stakeholder alignment are established',
  '## 📋 Requirements Readiness',
  '- [x] Scope and acceptance criteria are understood',
  '## 🔗 Dependency Readiness',
  '- [ ] Major dependencies are identified',
  '',
  '# ✅ Definition of Done (DoD)',
  '## 🎯 Outcome Achieved',
  '- [ ] Business objective and success criteria have been achieved ~ due:2026-10-01',
  '## ✅ Closure Decision',
  '- [~] Epic meets Definition of Done',
].join('\n');

describe('parseSmartChecklist', () => {
  it('finds every item, in order', () => {
    expect(parseSmartChecklist(EPIC_CHECKLIST_TEXT).items.map((item) => item.text)).toEqual([
      'Business objective, success criteria, and stakeholder alignment are established',
      'Scope and acceptance criteria are understood',
      'Major dependencies are identified',
      'Business objective and success criteria have been achieved',
      'Epic meets Definition of Done',
    ]);
  });

  it('reads each item’s state, including skipped and in-progress', () => {
    expect(parseSmartChecklist(EPIC_CHECKLIST_TEXT).items.map((item) => item.state))
      .toEqual(['open', 'done', 'open', 'open', 'skipped']);
  });

  it('remembers the group header each item sits under, so the review reads like the checklist', () => {
    const [firstItem, , , doneItem] = parseSmartChecklist(EPIC_CHECKLIST_TEXT).items;
    expect(firstItem.section).toBe('🎯 Business Readiness');
    expect(doneItem.section).toBe('🎯 Outcome Achieved');
  });

  it('keeps item metadata out of the item’s words', () => {
    const itemWithDueDate = parseSmartChecklist(EPIC_CHECKLIST_TEXT).items[3];
    expect(itemWithDueDate.text).not.toContain('due:');
  });

  it('accepts the other bullet styles people and instances write', () => {
    const items = parseSmartChecklist('* [ ] Star bullet\n+ [ ] Plus bullet\n[ ] No bullet\n  - [X] Indented done').items;
    expect(items).toHaveLength(4);
    expect(items[3].state).toBe('done');
  });

  it('finds no items in a field holding something else, rather than failing', () => {
    expect(parseSmartChecklist('Just some notes about this Epic.').items).toEqual([]);
    expect(parseSmartChecklist('').items).toEqual([]);
  });

  it('counts progress the way a PO reads it', () => {
    expect(countCompletedItems(parseSmartChecklist(EPIC_CHECKLIST_TEXT))).toEqual({ doneCount: 1, totalCount: 5 });
  });

  it('offers every item that is not already ticked, including skipped ones', () => {
    expect(listOpenItems(parseSmartChecklist(EPIC_CHECKLIST_TEXT))).toHaveLength(4);
  });
});

describe('applyChecklistCompletions — the rest of the checklist must survive', () => {
  it('ticks only the items named', () => {
    const checklist = parseSmartChecklist(EPIC_CHECKLIST_TEXT);
    const [firstOpenItem] = listOpenItems(checklist);

    const updatedText = applyChecklistCompletions(checklist, [firstOpenItem.id]);

    expect(updatedText).toContain('- [x] Business objective, success criteria, and stakeholder alignment are established');
    expect(updatedText).toContain('- [ ] Major dependencies are identified');
  });

  it('returns every other line byte for byte', () => {
    const checklist = parseSmartChecklist(EPIC_CHECKLIST_TEXT);
    const [firstOpenItem] = listOpenItems(checklist);

    const updatedLines = applyChecklistCompletions(checklist, [firstOpenItem.id]).split('\n');
    const originalLines = EPIC_CHECKLIST_TEXT.split('\n');

    expect(updatedLines).toHaveLength(originalLines.length);
    originalLines.forEach((originalLine, lineIndex) => {
      if (lineIndex === firstOpenItem.lineIndex) return;
      expect(updatedLines[lineIndex]).toBe(originalLine);
    });
  });

  it('keeps an item’s own metadata when ticking it', () => {
    const checklist = parseSmartChecklist(EPIC_CHECKLIST_TEXT);
    const itemWithDueDate = checklist.items[3];

    expect(applyChecklistCompletions(checklist, [itemWithDueDate.id]))
      .toContain('- [x] Business objective and success criteria have been achieved ~ due:2026-10-01');
  });

  it('changes nothing when no item is named', () => {
    const checklist = parseSmartChecklist(EPIC_CHECKLIST_TEXT);
    expect(applyChecklistCompletions(checklist, [])).toBe(EPIC_CHECKLIST_TEXT);
  });

  it('ignores an id that is not an open item rather than refusing the whole save', () => {
    // Someone ticked it in Jira between the analysis and the save. That is not an error; it is already done.
    const checklist = parseSmartChecklist(EPIC_CHECKLIST_TEXT);
    const alreadyDoneItem = checklist.items[1];

    expect(applyChecklistCompletions(checklist, [alreadyDoneItem.id, 'line-999'])).toBe(EPIC_CHECKLIST_TEXT);
  });

  it('can tick a skipped item, because a skipped item is not a done one', () => {
    const checklist = parseSmartChecklist(EPIC_CHECKLIST_TEXT);
    const skippedItem = checklist.items[4];

    expect(applyChecklistCompletions(checklist, [skippedItem.id])).toContain('- [x] Epic meets Definition of Done');
  });
});
