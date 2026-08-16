// checklistSyntax.test.ts — Proves the probe answers by experiment and puts the checklist back.

import { describe, expect, it, vi } from 'vitest';

import type { ChecklistItem, ChecklistItemState } from './checklistItems.ts';
import {
  CHECKLIST_LINE_FORMS,
  resolveFormIdByState,
  runChecklistSyntaxProbe,
} from './checklistSyntax.ts';

/** One item as the reader would return it. */
function buildItem(state: ChecklistItemState): ChecklistItem {
  return { id: 'item-1', text: 'this is a test', state, assigneeUserId: null, headingText: null };
}

/**
 * A fake instance that honours some forms and ignores the rest.
 *
 * Modelled on the live one: a plain dash means to do, a plus means done, and anything with a bracket
 * is stored as literal text and read back as an ordinary unfinished item.
 */
function buildFakeChecklist(honoured: Record<string, ChecklistItemState>) {
  const written: string[] = [];
  let currentState: ChecklistItemState = 'open';

  return {
    written,
    writeChecklistText: vi.fn(async (nextText: string) => {
      written.push(nextText);
      const matchedForm = CHECKLIST_LINE_FORMS
        .find((lineForm) => lineForm.buildLine('this is a test') === nextText);
      currentState = matchedForm ? honoured[matchedForm.id] ?? 'open' : 'open';
    }),
    readChecklistItems: vi.fn(async () => [buildItem(currentState)]),
  };
}

describe('runChecklistSyntaxProbe', () => {
  it('tries every candidate form and reports what each one produced', async () => {
    const fake = buildFakeChecklist({ dash: 'open', plus: 'done', tilde: 'skipped' });

    const probe = await runChecklistSyntaxProbe([buildItem('open')], 'this is a test', fake, '- original');

    expect(probe.results).toHaveLength(CHECKLIST_LINE_FORMS.length);
    expect(probe.results.find((result) => result.formId === 'plus')?.resultingState).toBe('done');
    expect(probe.results.find((result) => result.formId === 'tilde')?.resultingState).toBe('skipped');
  });

  it('names the form to use for each state it managed to produce', async () => {
    // The point of the whole exercise: an answer that is a fact about this instance rather than a
    // belief about the app.
    const fake = buildFakeChecklist({ dash: 'open', plus: 'done' });

    const probe = await runChecklistSyntaxProbe([buildItem('open')], 'this is a test', fake, '- original');

    expect(probe.formIdByState.done).toBe('plus');
    expect(probe.formIdByState.open).toBe('dash');
  });

  it('reports NO form for a state this instance cannot express', async () => {
    // Silence is the answer to record: "in progress" simply has no text form here, and knowing that
    // is worth as much as knowing the ones that work.
    const fake = buildFakeChecklist({ dash: 'open', plus: 'done' });

    const probe = await runChecklistSyntaxProbe([buildItem('open')], 'this is a test', fake, '- original');

    expect(probe.formIdByState['in-progress']).toBeUndefined();
  });

  it('puts the original checklist back when it finishes', async () => {
    // It mutates somebody's real checklist to find this out; leaving it mutated would be indefensible.
    const fake = buildFakeChecklist({ dash: 'open' });

    const probe = await runChecklistSyntaxProbe([buildItem('open')], 'this is a test', fake, '- original text');

    expect(probe.isRestored).toBe(true);
    expect(fake.written[fake.written.length - 1]).toBe('- original text');
  });

  it('still restores after a step throws, and keeps the results it did get', async () => {
    const fake = buildFakeChecklist({ dash: 'open' });
    fake.writeChecklistText.mockImplementationOnce(async () => { throw new Error('Jira said no'); });

    const probe = await runChecklistSyntaxProbe([buildItem('open')], 'this is a test', fake, '- original');

    expect(probe.results[0].errorMessage).toContain('Jira said no');
    expect(probe.isRestored).toBe(true);
  });

  it('says so loudly when it could NOT put the checklist back', async () => {
    const fake = buildFakeChecklist({ dash: 'open' });
    fake.writeChecklistText.mockImplementation(async (nextText: string) => {
      if (nextText === '- original') throw new Error('restore refused');
    });

    const probe = await runChecklistSyntaxProbe([buildItem('open')], 'this is a test', fake, '- original');

    expect(probe.isRestored).toBe(false);
    expect(probe.errorMessage).toContain('could not put the checklist back');
    // The text it read is included, so the checklist can be rebuilt by hand.
    expect(probe.errorMessage).toContain('this is a test');
  });
});

describe('resolveFormIdByState', () => {
  it('prefers the PLAINEST form when two produce the same state', () => {
    // Ordered from plainest outwards: a bare marker is less likely to be stored as literal text by a
    // future version of the app than one wrapped in brackets.
    const formIdByState = resolveFormIdByState([
      { formId: 'dash', label: '- item', resultingState: 'open', errorMessage: null },
      { formId: 'bracket-blank', label: '- [ ] item', resultingState: 'open', errorMessage: null },
    ]);

    expect(formIdByState.open).toBe('dash');
  });

  it('ignores a form that produced nothing readable', () => {
    expect(resolveFormIdByState([
      { formId: 'star', label: '* item', resultingState: null, errorMessage: 'not found' },
    ])).toEqual({});
  });
});
