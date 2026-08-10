// subtaskChecklistConversion.test.js — Proves the sub-task → Smart Checklist conversion is safe to point
// at production Jira: it never overwrites an existing checklist, never double-adds on a re-run, and never
// hides what converting a sub-task throws away.

'use strict';

const {
  findChecklistFieldCandidates,
  isSubtaskDone,
  describeLossyContent,
  renderChecklistLine,
  renderChecklistBlock,
  checklistContainsSubtask,
  mergeChecklistText,
  groupSubtasksByParent,
  buildConversionPlan,
} = require('./subtaskChecklistConversion');

/** Builds a sub-task shaped the way Jira's REST v2 search returns one. */
function makeSubtask(key, summary, overrides = {}) {
  return {
    key,
    fields: {
      summary,
      status: overrides.status || { name: 'To Do', statusCategory: { key: 'new' } },
      assignee: overrides.assignee ?? null,
      parent: overrides.parentKey === null ? undefined : { key: overrides.parentKey || 'ENCUC-100' },
      ...overrides.extraFields,
    },
  };
}

const DONE_STATUS = { name: 'Closed', statusCategory: { key: 'done' } };

describe('findChecklistFieldCandidates — never hard-code a paid app field id', () => {
  it('finds fields whose name mentions checklist', () => {
    const candidates = findChecklistFieldCandidates([
      { id: 'summary', name: 'Summary' },
      { id: 'customfield_12345', name: 'Smart Checklist', schema: { custom: 'com.railsware.checklist' } },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('customfield_12345');
  });

  it('also finds fields whose app schema mentions checklist even when the name does not', () => {
    const candidates = findChecklistFieldCandidates([
      { id: 'customfield_999', name: 'Acceptance Steps', schema: { custom: 'com.railsware.SmartChecklist:field' } },
    ]);

    expect(candidates).toHaveLength(1);
  });

  it('ranks a name match above a schema-only match, so the obvious field is offered first', () => {
    const candidates = findChecklistFieldCandidates([
      { id: 'customfield_999', name: 'Acceptance Steps', schema: { custom: 'checklist-app' } },
      { id: 'customfield_111', name: 'Smart Checklist', schema: {} },
    ]);

    expect(candidates[0].id).toBe('customfield_111');
  });

  it('returns nothing rather than guessing when the instance has no checklist field', () => {
    expect(findChecklistFieldCandidates([{ id: 'summary', name: 'Summary' }])).toEqual([]);
    expect(findChecklistFieldCandidates(null)).toEqual([]);
  });
});

describe('isSubtaskDone — read the category, not the status name', () => {
  it('treats a done-category status as complete however it is named', () => {
    expect(isSubtaskDone(makeSubtask('A-1', 'x', { status: DONE_STATUS }))).toBe(true);
  });

  it('does not treat an in-progress status as complete', () => {
    const inProgress = { name: 'Done-ish', statusCategory: { key: 'indeterminate' } };
    expect(isSubtaskDone(makeSubtask('A-1', 'x', { status: inProgress }))).toBe(false);
  });
});

describe('renderChecklistLine — one sub-task, one line', () => {
  it('renders an open sub-task as an unticked item carrying its key', () => {
    const line = renderChecklistLine(makeSubtask('ENCUC-1', 'Build the widget'));
    expect(line).toBe('- [ ] ENCUC-1 Build the widget (To Do)');
  });

  it('renders a finished sub-task as a ticked item', () => {
    const line = renderChecklistLine(makeSubtask('ENCUC-2', 'Ship it', { status: DONE_STATUS }));
    expect(line.startsWith('- [x] ')).toBe(true);
  });

  it('keeps the assignee so the conversion does not silently drop who owned the work', () => {
    const subtask = makeSubtask('ENCUC-3', 'Review', { assignee: { displayName: 'Smith, Mike (CTR)' } });
    expect(renderChecklistLine(subtask)).toContain('Smith, Mike (CTR)');
  });

  it('collapses newlines in a summary so one sub-task can never become two checklist items', () => {
    const subtask = makeSubtask('ENCUC-4', 'First line\nsecond line');
    expect(renderChecklistLine(subtask).split('\n')).toHaveLength(1);
  });

  it('can omit the key when the team does not want dead references left behind', () => {
    const line = renderChecklistLine(makeSubtask('ENCUC-5', 'Tidy up'), { shouldIncludeKey: false });
    expect(line).not.toContain('ENCUC-5');
  });
});

describe('renderChecklistBlock — deterministic output', () => {
  it('orders items by key so a re-run produces identical text', () => {
    const block = renderChecklistBlock([
      makeSubtask('ENCUC-10', 'Tenth'),
      makeSubtask('ENCUC-2', 'Second'),
    ]);

    const itemLines = block.split('\n').filter((line) => line.startsWith('- '));
    expect(itemLines[0]).toContain('ENCUC-2');
    expect(itemLines[1]).toContain('ENCUC-10');
  });

  it('puts a heading above the converted items', () => {
    const block = renderChecklistBlock([makeSubtask('ENCUC-1', 'x')], { headingText: 'Converted sub-tasks' });
    expect(block.split('\n')[0]).toBe('# Converted sub-tasks');
  });
});

describe('mergeChecklistText — the parent never loses what it already had', () => {
  it('keeps the existing checklist and appends below it', () => {
    const existing = '# Definition of Done\n- [x] Peer reviewed';
    const result = mergeChecklistText(existing, [makeSubtask('ENCUC-1', 'New work')]);

    expect(result.mergedText).toContain('# Definition of Done');
    expect(result.mergedText).toContain('- [x] Peer reviewed');
    expect(result.mergedText).toContain('ENCUC-1');
    expect(result.hasChanged).toBe(true);
  });

  it('writes nothing when every sub-task is already on the checklist', () => {
    const existing = '- [ ] ENCUC-1 New work (To Do)';
    const result = mergeChecklistText(existing, [makeSubtask('ENCUC-1', 'New work')]);

    expect(result.hasChanged).toBe(false);
    expect(result.mergedText).toBe(existing);
    expect(result.addedSubtaskKeys).toEqual([]);
  });

  it('is idempotent — running the merge twice adds the item exactly once', () => {
    const subtasks = [makeSubtask('ENCUC-1', 'New work')];
    const firstRun = mergeChecklistText('', subtasks);
    const secondRun = mergeChecklistText(firstRun.mergedText, subtasks);

    expect(secondRun.hasChanged).toBe(false);
    expect(secondRun.mergedText).toBe(firstRun.mergedText);
  });

  it('still recognises an item whose box was ticked by hand after the conversion', () => {
    const existing = '- [x] ENCUC-1 New work (To Do)';
    expect(mergeChecklistText(existing, [makeSubtask('ENCUC-1', 'New work')]).hasChanged).toBe(false);
  });

  it('still recognises an item that was reworded, because the key is matched first', () => {
    const existing = '- [ ] ENCUC-1 completely different wording now';
    expect(mergeChecklistText(existing, [makeSubtask('ENCUC-1', 'New work')]).hasChanged).toBe(false);
  });

  it('adds only the missing sub-task when the parent already holds the others', () => {
    const existing = '- [ ] ENCUC-1 First';
    const result = mergeChecklistText(existing, [
      makeSubtask('ENCUC-1', 'First'),
      makeSubtask('ENCUC-2', 'Second'),
    ]);

    expect(result.addedSubtaskKeys).toEqual(['ENCUC-2']);
    expect(result.mergedText.match(/ENCUC-1/g)).toHaveLength(1);
  });

  it('does not repeat the heading on a later top-up run', () => {
    const firstRun = mergeChecklistText('', [makeSubtask('ENCUC-1', 'First')]);
    const secondRun = mergeChecklistText(firstRun.mergedText, [makeSubtask('ENCUC-2', 'Second')]);

    expect(secondRun.mergedText.match(/# Converted sub-tasks/g)).toHaveLength(1);
  });

  it('starts cleanly when the parent had no checklist at all', () => {
    const result = mergeChecklistText('', [makeSubtask('ENCUC-1', 'First')]);
    expect(result.mergedText.startsWith('# Converted sub-tasks')).toBe(true);
  });
});

describe('checklistContainsSubtask — matching without false positives', () => {
  it('does not match a different issue whose key merely shares a prefix', () => {
    expect(checklistContainsSubtask('- [ ] ENCUC-10 Other', makeSubtask('ENCUC-1', 'x'))).toBe(false);
  });
});

describe('describeLossyContent — say what conversion destroys', () => {
  it('names logged time, comments and links', () => {
    const subtask = makeSubtask('ENCUC-1', 'x', {
      extraFields: {
        worklog: { worklogs: [{ timeSpentSeconds: 3600 }] },
        comment: { comments: [{ id: '1' }] },
        issuelinks: [{ id: '2' }],
      },
    });

    expect(describeLossyContent(subtask)).toEqual(
      expect.arrayContaining(['logged time', 'comments', 'issue links']),
    );
  });

  it('names story points held in the instance-specific field', () => {
    const subtask = makeSubtask('ENCUC-1', 'x', { extraFields: { customfield_10002: 3 } });
    expect(describeLossyContent(subtask, ['customfield_10002'])).toContain('story points');
  });

  it('reports nothing for a sub-task that is only a summary', () => {
    expect(describeLossyContent(makeSubtask('ENCUC-1', 'x'))).toEqual([]);
  });
});

describe('groupSubtasksByParent', () => {
  it('buckets sub-tasks under their parent', () => {
    const { subtasksByParentKey } = groupSubtasksByParent([
      makeSubtask('ENCUC-1', 'a', { parentKey: 'ENCUC-100' }),
      makeSubtask('ENCUC-2', 'b', { parentKey: 'ENCUC-100' }),
      makeSubtask('ENCUC-3', 'c', { parentKey: 'ENCUC-200' }),
    ]);

    expect(subtasksByParentKey.get('ENCUC-100')).toHaveLength(2);
    expect(subtasksByParentKey.get('ENCUC-200')).toHaveLength(1);
  });

  it('reports a parentless sub-task rather than dropping it silently', () => {
    const { orphanedSubtaskKeys } = groupSubtasksByParent([
      makeSubtask('ENCUC-9', 'stray', { parentKey: null }),
    ]);

    expect(orphanedSubtaskKeys).toEqual(['ENCUC-9']);
  });
});

describe('buildConversionPlan — what the dry run shows is what gets written', () => {
  it('produces one entry per parent with its before and after text', () => {
    const plan = buildConversionPlan(
      [
        makeSubtask('ENCUC-1', 'First', { parentKey: 'ENCUC-100' }),
        makeSubtask('ENCUC-2', 'Second', { parentKey: 'ENCUC-200' }),
      ],
      { 'ENCUC-100': '- [ ] pre-existing' },
    );

    expect(plan.parentPlans).toHaveLength(2);
    expect(plan.changedParentCount).toBe(2);
    expect(plan.parentPlans[0].previousChecklistText).toBe('- [ ] pre-existing');
    expect(plan.parentPlans[0].nextChecklistText).toContain('- [ ] pre-existing');
  });

  it('marks a parent unchanged when its checklist already covers every sub-task', () => {
    const plan = buildConversionPlan(
      [makeSubtask('ENCUC-1', 'First', { parentKey: 'ENCUC-100' })],
      { 'ENCUC-100': '- [ ] ENCUC-1 First' },
    );

    expect(plan.changedParentCount).toBe(0);
    expect(plan.parentPlans[0].hasChanged).toBe(false);
  });

  it('surfaces loss warnings against the sub-task that carries the content', () => {
    const plan = buildConversionPlan(
      [makeSubtask('ENCUC-1', 'First', {
        parentKey: 'ENCUC-100',
        extraFields: { worklog: { worklogs: [{ timeSpentSeconds: 60 }] } },
      })],
      {},
    );

    expect(plan.parentPlans[0].lossWarnings).toEqual([
      { subtaskKey: 'ENCUC-1', losesContent: ['logged time'] },
    ]);
  });

  it('counts every sub-task it was given, including ones with no parent', () => {
    const plan = buildConversionPlan(
      [
        makeSubtask('ENCUC-1', 'First', { parentKey: 'ENCUC-100' }),
        makeSubtask('ENCUC-9', 'stray', { parentKey: null }),
      ],
      {},
    );

    expect(plan.totalSubtaskCount).toBe(2);
    expect(plan.orphanedSubtaskKeys).toEqual(['ENCUC-9']);
  });
});
