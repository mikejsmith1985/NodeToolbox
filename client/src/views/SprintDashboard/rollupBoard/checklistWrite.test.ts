// checklistWrite.test.ts — Proves a ticked box round-trips back through the reader unchanged.

import { describe, expect, it } from 'vitest';

import { parseChecklistItems, type ChecklistItem } from './checklistItems.ts';
import {
  buildChecklistText,
  chooseWritableChecklistFieldId,
  describeChecklistWriteAdvice,
  describeChecklistWriteBlock,
  describeRefusedStep,
  describeUnwritableStateBlock,
  judgeChecklistFields,
  summarizeChecklistWritability,
  verifyChecklistItemState,
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
    // The checklist app's own word, because this names a value that lives in the app.
    expect(describeChecklistState('in-progress')).toBe('In progress');
    expect(describeChecklistState('skipped')).toBe('Skipped');
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

/** The app's own stored value: a Java object graph, readable with care and never writable. */
const APP_DUMP = 'Checklist(id=88538, issueId=305985, _items=[Item(id=1, value=a, rank=0)])';

describe('refusing a write that Jira would accept and the app would ignore', () => {
  it('never writes to a field holding the app’s own internal data', () => {
    // The silent failure this exists to prevent: Jira takes the string, returns 204, and the
    // checklist does not change. Editable is not the same as meaningful.
    expect(chooseWritableChecklistFieldId(
      ['customfield_dump'], ['customfield_dump'], 'customfield_dump', { customfield_dump: APP_DUMP },
    )).toBeNull();
  });

  it('prefers a plain-text checklist field over the dump the board reads from', () => {
    expect(chooseWritableChecklistFieldId(
      ['customfield_dump', 'customfield_text'],
      ['customfield_dump', 'customfield_text'],
      'customfield_dump',
      { customfield_dump: APP_DUMP, customfield_text: '- [ ] a' },
    )).toBe('customfield_text');
  });

  it('explains the dump case in words that name the fix', () => {
    const reason = describeChecklistWriteBlock({
      issueKey: 'DEV-1',
      editableFieldIds: ['customfield_dump'],
      candidateFieldIds: ['customfield_dump'],
      issueFields: { customfield_dump: APP_DUMP },
    });

    expect(reason).toContain('the checklist app');
    expect(reason).toContain('TEXT field');
  });

  it('explains the no-field-at-all case differently, because the fix is different', () => {
    const reason = describeChecklistWriteBlock({
      issueKey: 'DEV-1', editableFieldIds: ['summary'], candidateFieldIds: ['customfield_1'], issueFields: {},
    });

    expect(reason).toContain('edit screen');
  });

  it('says nothing when there is genuinely nothing blocking the write', () => {
    expect(describeChecklistWriteBlock({
      issueKey: 'DEV-1',
      editableFieldIds: ['customfield_text'],
      candidateFieldIds: ['customfield_text'],
      issueFields: { customfield_text: '- [ ] a' },
    })).toBeNull();
  });
});

describe('verifyChecklistItemState', () => {
  it('accepts a change the checklist actually made', () => {
    expect(verifyChecklistItemState(
      [buildItem({ id: 'item-1', state: 'done' })], 'item-1', 'done', 'customfield_text',
    ).isWritten).toBe(true);
  });

  it('reports a write Jira accepted and the checklist app ignored', () => {
    // A 204 proves Jira stored a string. It proves nothing about the third-party app that owns the
    // checklist, and treating it as success is how a drag does nothing and reports nothing.
    const verdict = verifyChecklistItemState(
      [buildItem({ id: 'item-1', state: 'open' })], 'item-1', 'in-progress', 'customfield_text',
    );

    expect(verdict.isWritten).toBe(false);
    // The FACT only. What to do about it depends on which fields the instance has, which is a
    // different question with a different answer — see describeChecklistWriteAdvice.
    expect(verdict.message).toContain('the checklist app ignored it');
    expect(verdict.message).toContain('customfield_text');
  });

  it('reports an item that vanished from the checklist it was read from', () => {
    const verdict = verifyChecklistItemState([], 'item-1', 'done', 'customfield_text');

    expect(verdict.isWritten).toBe(false);
    expect(verdict.message).toContain('no longer in the checklist');
  });
});

describe('judgeChecklistFields — evidence for choosing a write target', () => {
  const CANDIDATES = [
    { id: 'cf_dump', name: 'Smart Checklist' },
    { id: 'cf_text', name: 'Checklists' },
    { id: 'cf_progress', name: 'Smart Checklist Progress' },
  ];

  it('names the field that holds the app’s own data, which a write would vanish into', () => {
    const [dumpVerdict] = judgeChecklistFields({
      candidates: CANDIDATES,
      editableFieldIds: ['cf_dump', 'cf_text'],
      issueFields: { cf_dump: APP_DUMP, cf_text: '- [ ] a', cf_progress: '0/1' },
    });

    expect(dumpVerdict.holds).toBe('app-data');
    expect(dumpVerdict.summary).toContain('ignore it');
  });

  it('marks editable plain text as the likely target', () => {
    const verdicts = judgeChecklistFields({
      candidates: CANDIDATES,
      editableFieldIds: ['cf_dump', 'cf_text'],
      issueFields: { cf_dump: APP_DUMP, cf_text: '- [ ] a', cf_progress: '0/1' },
    });

    expect(verdicts.find((verdict) => verdict.id === 'cf_text')?.summary).toContain('likely write target');
  });

  it('says plainly when Jira would refuse the write, which is a different problem', () => {
    // Not on the edit screen is an admin fix; the app ignoring it is a wrong-field fix. Collapsing
    // the two into "cannot write" would send somebody after the wrong one.
    const verdicts = judgeChecklistFields({
      candidates: CANDIDATES,
      editableFieldIds: ['cf_dump', 'cf_text'],
      issueFields: { cf_dump: APP_DUMP, cf_text: '- [ ] a', cf_progress: '0/1' },
    });

    expect(verdicts.find((verdict) => verdict.id === 'cf_progress')?.summary)
      .toContain('not on this issue’s edit screen');
  });

  it('reports an empty editable field as editable rather than as a problem', () => {
    const [verdict] = judgeChecklistFields({
      candidates: [{ id: 'cf_text', name: 'Checklists' }],
      editableFieldIds: ['cf_text'],
      issueFields: {},
    });

    expect(verdict.holds).toBe('empty');
    expect(verdict.isOnEditScreen).toBe(true);
  });
});

describe('a field the team nominated', () => {
  it('beats every guess, because the team knows which field the app reads', () => {
    expect(chooseWritableChecklistFieldId(
      ['cf_a', 'cf_b'], ['cf_a', 'cf_b'], 'cf_a',
      { cf_a: '- [ ] a', cf_b: '- [ ] a' },
      'cf_b',
    )).toBe('cf_b');
  });

  it('does NOT beat the dump check, which exists to stop a write that looks like it worked', () => {
    expect(chooseWritableChecklistFieldId(
      ['cf_dump', 'cf_text'], ['cf_dump', 'cf_text'], 'cf_text',
      { cf_dump: APP_DUMP, cf_text: '- [ ] a' },
      'cf_dump',
    )).toBe('cf_text');
  });

  it('falls back to the board’s own choice when the nominated field is not editable here', () => {
    expect(chooseWritableChecklistFieldId(
      ['cf_text'], ['cf_text'], 'cf_text', { cf_text: '- [ ] a' }, 'cf_missing',
    )).toBe('cf_text');
  });
});

describe('describeChecklistWriteAdvice', () => {
  const VERDICTS = [
    { id: 'cf_dump', name: 'Smart Checklist', holds: 'app-data' as const, isOnEditScreen: true, summary: '' },
    { id: 'cf_text', name: 'Checklists', holds: 'text' as const, isOnEditScreen: true, summary: '' },
    { id: 'cf_other', name: 'Checklist Notes', holds: 'text' as const, isOnEditScreen: true, summary: '' },
  ];

  it('names the OTHER candidates worth trying, so the next attempt is informed', () => {
    const advice = describeChecklistWriteAdvice(VERDICTS, 'cf_text');

    expect(advice).toContain('Checklist Notes');
    expect(advice).not.toContain('Smart Checklist (cf_dump)');
    expect(advice).toContain('Write checklist changes to');
  });

  it('says plainly when NOTHING else can work, instead of sending somebody round a list', () => {
    // The situation that matters: an instance that simply does not expose the checklist for writing.
    // Offering a picker there would be a loop with no exit.
    const advice = describeChecklistWriteAdvice(
      [VERDICTS[0], { ...VERDICTS[1], id: 'cf_text' }], 'cf_text',
    );

    expect(advice).toContain('cannot change checklist items here at all');
    expect(advice).toContain('keep READING');
  });

  it('does not count the app’s own data field as somewhere else to try', () => {
    const advice = describeChecklistWriteAdvice([VERDICTS[0], VERDICTS[1]], 'cf_text');

    expect(advice).toContain('cannot change checklist items here at all');
  });

  it('does not count a field Jira would refuse the write to', () => {
    const advice = describeChecklistWriteAdvice(
      [VERDICTS[1], { ...VERDICTS[2], isOnEditScreen: false }], 'cf_text',
    );

    expect(advice).toContain('cannot change checklist items here at all');
  });
});

describe('summarizeChecklistWritability — decided before anybody tries', () => {
  it('says a checklist cannot be written when every field is the app’s own data', () => {
    // The verified situation on the live instance: one dump field Jira accepts and the app ignores.
    const writability = summarizeChecklistWritability([
      { id: 'cf_dump', name: 'Smart Checklist', holds: 'app-data', isOnEditScreen: true, summary: '' },
    ]);

    expect(writability.canWrite).toBe(false);
    expect(writability.reason).toContain('does not expose Smart Checklist for editing');
    expect(writability.reason).toContain('Smart Checklist');
  });

  it('says so too when nothing is on the edit screen at all', () => {
    const writability = summarizeChecklistWritability([
      { id: 'cf_text', name: 'Checklists', holds: 'text', isOnEditScreen: false, summary: '' },
    ]);

    expect(writability.canWrite).toBe(false);
  });

  it('allows writing when one editable plain-text field exists', () => {
    expect(summarizeChecklistWritability([
      { id: 'cf_dump', name: 'Smart Checklist', holds: 'app-data', isOnEditScreen: true, summary: '' },
      { id: 'cf_text', name: 'Checklists', holds: 'text', isOnEditScreen: true, summary: '' },
    ]).canWrite).toBe(true);
  });

  it('assumes writable while nothing has been judged yet, rather than blocking on no evidence', () => {
    // The board judges against a sampled issue after load. Refusing before that would make every
    // board briefly read-only for no reason.
    expect(summarizeChecklistWritability([]).canWrite).toBe(true);
  });

  it('says what the answer was based on, since field configuration is per issue type', () => {
    expect(summarizeChecklistWritability([
      { id: 'cf_dump', name: 'Smart Checklist', holds: 'app-data', isOnEditScreen: true, summary: '' },
    ]).reason).toContain('edit screen');
  });
});

describe('once a state has landed, the advice stops blaming the field', () => {
  const VERDICTS = [
    { id: 'cf_dump', name: 'Smart Checklist', holds: 'app-data' as const, isOnEditScreen: true, summary: '' },
    { id: 'cf_text', name: 'Checklists', holds: 'text' as const, isOnEditScreen: true, summary: '' },
  ];

  it('says the FIELD is right when other states have already written through it', () => {
    // Proved on the live instance: "To do" lands through customfield_10252 and "In progress" does
    // not. Telling somebody to go and pick a different field would send them to change a setting
    // that is already correct.
    const advice = describeChecklistWriteAdvice(VERDICTS, 'cf_text', new Set(['open', 'done']));

    expect(advice).toContain('the field is right');
    expect(advice).toContain('To do and Done');
    expect(advice).not.toContain('cannot change checklist items here at all');
  });

  it('still blames the field while nothing at all has landed', () => {
    expect(describeChecklistWriteAdvice(VERDICTS, 'cf_text', new Set()))
      .toContain('cannot change checklist items here at all');
  });
});

describe('describeUnwritableStateBlock', () => {
  it('names the state and where it CAN be set', () => {
    const message = describeUnwritableStateBlock('in-progress');

    expect(message).toContain('In progress');
    expect(message).toContain('set this one in Jira');
  });

  it('points at the experiment rather than declaring a limit it cannot know', () => {
    // The app documents a marker for every status, so a refusal almost always means a CUSTOM status
    // rather than a state with no text form. Claiming the latter sent somebody to the wrong fix.
    expect(describeUnwritableStateBlock('skipped')).toContain('Find out what this checklist accepts');
  });
});

describe('describeRefusedStep', () => {
  it('names the stage in between when the app will not jump two at once', () => {
    // Observed: Done would not go straight back to To do, while every neighbouring step worked.
    expect(describeRefusedStep('done', 'open')).toBe(
      'Move it to In progress first — the checklist will not go straight there.',
    );
  });

  it('names it going forwards too', () => {
    expect(describeRefusedStep('open', 'done')).toContain('In progress first');
  });

  it('stays a single short sentence, because this is not a fault to go and fix', () => {
    expect(describeRefusedStep('done', 'open').length).toBeLessThan(90);
  });

  it('says something sensible for a state outside the sequence', () => {
    // Skipped is a decision about an item, not a stage of it, so it is nobody's way anywhere.
    expect(describeRefusedStep('skipped', 'done')).toContain('would not move that item to Done');
  });
});
