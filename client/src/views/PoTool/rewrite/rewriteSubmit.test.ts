// rewriteSubmit.test.ts — Submit only-approved via the reused write path, with drift + no-op handling
// (spec 030, US4/US5). Uses the REAL buildCompositionCommit + runCompositionCommit; saveField/fetchLive mocked.

import { describe, expect, it, vi } from 'vitest';

import { checkForDrift, submitApprovedItems } from './rewriteSubmit.ts';
import type { SubmitContext, SubmitDeps } from './rewriteSubmit.ts';
import type { CapturedOriginal, RewriteBatch, RewriteItem } from './rewriteBatchModel';

const AC_FIELD = 'customfield_10200';
const CONTEXT: SubmitContext = { acceptanceCriteriaFieldId: AC_FIELD, fieldDescriptors: [] };

function captured(over: Partial<CapturedOriginal> = {}): CapturedOriginal {
  return { summary: 'S', description: 'orig desc', acceptanceCriteria: 'orig ac', capturedAtIso: '2026-07-26T00:00:00Z', ...over };
}

function item(jiraKey: string, state: RewriteItem['state'], over: Partial<RewriteItem> = {}): RewriteItem {
  return {
    jiraKey,
    original: captured(),
    proposed: { description: 'Description:\nrewritten', acceptanceCriteria: 'new ac', isEdited: false },
    state,
    captureError: null,
    submitResult: null,
    ...over,
  };
}

function batch(items: RewriteItem[]): RewriteBatch {
  return { id: 'b1', name: 'B', teamProfileId: 't', createdAtIso: 'x', updatedAtIso: 'x', items };
}

/** fetchLive returns content equal to the captured original (i.e. unchanged since capture) by default. */
function deps(over: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    fetchLive: vi.fn(async () => captured()),
    saveField: vi.fn(async () => {}),
    ...over,
  };
}

describe('submitApprovedItems', () => {
  it('writes an approved item whose live content is unchanged since capture', async () => {
    const d = deps();
    const result = await submitApprovedItems(batch([item('ABC-1', 'approved')]), CONTEXT, d);
    expect(result.items[0].state).toBe('submitted');
    // description + AC written (summary unchanged, so not written).
    expect(d.saveField).toHaveBeenCalledWith('ABC-1', 'description', 'Description:\nrewritten');
    expect(d.saveField).toHaveBeenCalledWith('ABC-1', AC_FIELD, 'new ac');
  });

  it('never writes rejected/reviewing items, and skips already-submitted', async () => {
    const d = deps();
    const result = await submitApprovedItems(
      batch([item('ABC-1', 'rejected'), item('ABC-2', 'reviewing'), item('ABC-3', 'submitted')]),
      CONTEXT, d,
    );
    expect(d.saveField).not.toHaveBeenCalled();
    expect(result.items.map((i) => i.state)).toEqual(['rejected', 'reviewing', 'submitted']);
  });

  it('holds a changed-since-capture item (no write) unless submit-anyway is chosen', async () => {
    const changedLive = deps({ fetchLive: vi.fn(async () => captured({ description: 'someone edited this in Jira' })) });
    const held = await submitApprovedItems(batch([item('ABC-1', 'approved')]), CONTEXT, changedLive);
    expect(held.items[0].state).toBe('changed');
    expect(changedLive.saveField).not.toHaveBeenCalled();

    const anyway = deps({ fetchLive: vi.fn(async () => captured({ description: 'someone edited this in Jira' })) });
    const written = await submitApprovedItems(batch([item('ABC-1', 'approved')]), CONTEXT, anyway, { submitAnywayKeys: ['ABC-1'] });
    expect(written.items[0].state).toBe('submitted');
    expect(anyway.saveField).toHaveBeenCalled();
  });

  it('treats a proposal equal to live content as a no-op success (nothing written)', async () => {
    const noop = item('ABC-1', 'approved', {
      original: captured({ description: 'Description:\nsame', acceptanceCriteria: 'same ac' }),
      proposed: { description: 'Description:\nsame', acceptanceCriteria: 'same ac', isEdited: false },
    });
    const d = deps({ fetchLive: vi.fn(async () => captured({ description: 'Description:\nsame', acceptanceCriteria: 'same ac' })) });
    const result = await submitApprovedItems(batch([noop]), CONTEXT, d);
    expect(result.items[0].state).toBe('submitted');
    expect(result.items[0].submitResult).toEqual({ ok: true });
    expect(d.saveField).not.toHaveBeenCalled();
  });

  it('checkForDrift flags a changed approved item without writing, and clears a reverted one', async () => {
    const changed = deps({ fetchLive: vi.fn(async () => captured({ description: 'edited upstream' })) });
    const flagged = await checkForDrift(batch([item('ABC-1', 'approved'), item('ABC-2', 'reviewing')]), changed);
    expect(flagged.items[0].state).toBe('changed');
    expect(flagged.items[1].state).toBe('reviewing'); // not approved → not checked
    expect(changed.saveField).not.toHaveBeenCalled(); // a check never writes

    const reverted = deps(); // live now matches the capture again
    const cleared = await checkForDrift(batch([item('ABC-1', 'changed')]), reverted);
    expect(cleared.items[0].state).toBe('approved');
  });

  it('a per-item write failure is captured and does not block the rest', async () => {
    const saveField = vi.fn()
      .mockRejectedValueOnce(new Error('Field is not on the screen.')) // ABC-1 description write fails
      .mockResolvedValue(undefined);
    const d = deps({ saveField });
    const result = await submitApprovedItems(batch([item('ABC-1', 'approved'), item('ABC-2', 'approved')]), CONTEXT, d);
    expect(result.items[0].state).toBe('failed');
    expect(result.items[0].submitResult?.fieldErrors?.join(' ')).toMatch(/not on the screen/);
    expect(result.items[1].state).toBe('submitted');
  });
});
