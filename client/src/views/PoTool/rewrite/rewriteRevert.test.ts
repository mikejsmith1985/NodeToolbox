// rewriteRevert.test.ts — Putting a Feature back exactly as Toolbox found it.
//
// A re-write nobody likes is worse than no re-write, because the original is gone and rebuilding it
// from memory is a worse job than the one that was replaced. The "before" snapshot has always been
// captured; this is the half that gives it back.
//
// The one thing it must never do is quietly undo somebody else's work. Between the write and the
// revert a person may have edited the issue, and restoring the snapshot would discard that edit
// without either of them knowing.

import { describe, expect, it, vi } from 'vitest';

import { readRevertConflicts, revertItems } from './rewriteRevert.ts';
import type { SubmitContext, SubmitDeps } from './rewriteSubmit.ts';
import type { CapturedOriginal, RewriteBatch, RewriteItem } from './rewriteBatchModel';

const AC_FIELD = 'customfield_10200';
const CONTEXT: SubmitContext = { acceptanceCriteriaFieldId: AC_FIELD, fieldDescriptors: [] };

function captured(over: Partial<CapturedOriginal> = {}): CapturedOriginal {
  return {
    summary: 'Original summary',
    description: 'orig desc',
    acceptanceCriteria: 'orig ac',
    capturedAtIso: '2026-07-26T00:00:00Z',
    ...over,
  };
}

/** What Toolbox wrote, which is what the live issue should still hold if nobody has touched it. */
function whatToolboxWrote(over: Partial<CapturedOriginal> = {}): CapturedOriginal {
  return captured({ description: 'rewritten desc', acceptanceCriteria: 'rewritten ac', ...over });
}

function item(jiraKey: string, state: RewriteItem['state'], over: Partial<RewriteItem> = {}): RewriteItem {
  return {
    jiraKey,
    original: captured(),
    proposed: { description: 'rewritten desc', acceptanceCriteria: 'rewritten ac', isEdited: false },
    state,
    captureError: null,
    submitResult: null,
    ...over,
  };
}

function batch(items: RewriteItem[]): RewriteBatch {
  return { id: 'b1', name: 'B', teamProfileId: 't', createdAtIso: 'x', updatedAtIso: 'x', items };
}

function deps(over: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    fetchLive: vi.fn(async () => whatToolboxWrote()),
    saveField: vi.fn(async () => {}),
    ...over,
  };
}

describe('readRevertConflicts', () => {
  it('finds nothing to warn about when the issue still holds what Toolbox wrote', () => {
    expect(readRevertConflicts(item('ABC-1', 'submitted'), whatToolboxWrote())).toEqual([]);
  });

  it('names the description when somebody has edited it since', () => {
    const live = whatToolboxWrote({ description: 'someone else edited this' });
    expect(readRevertConflicts(item('ABC-1', 'submitted'), live)).toEqual(['Description']);
  });

  it('names the acceptance criteria when that is what changed', () => {
    const live = whatToolboxWrote({ acceptanceCriteria: 'someone added a criterion' });
    expect(readRevertConflicts(item('ABC-1', 'submitted'), live)).toEqual(['Acceptance Criteria']);
  });

  it('names the summary when it no longer matches the snapshot', () => {
    // Toolbox never writes the summary, so ANY difference from the snapshot is somebody else's --
    // and reverting all three fields together would replace it.
    const live = whatToolboxWrote({ summary: 'Renamed by the PO' });
    expect(readRevertConflicts(item('ABC-1', 'submitted'), live)).toEqual(['Summary']);
  });

  it('names every field at once, so one warning covers the whole revert', () => {
    const live = { summary: 'Renamed', description: 'edited', acceptanceCriteria: 'edited', capturedAtIso: 'x' };
    expect(readRevertConflicts(item('ABC-1', 'submitted'), live))
      .toEqual(['Summary', 'Description', 'Acceptance Criteria']);
  });

  it('treats an item Toolbox never wrote as having nothing to compare against', () => {
    const neverWritten = item('ABC-1', 'submitted', { proposed: null });
    expect(readRevertConflicts(neverWritten, whatToolboxWrote())).toEqual([]);
  });
});

describe('revertItems', () => {
  it('restores the fields Toolbox changed, exactly as captured', async () => {
    // The summary is not written here because it never moved — Toolbox does not touch it, so on the
    // safe path it already holds the captured value and writing it again would be noise.
    const revertDeps = deps();
    const result = await revertItems(batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1']);

    expect(revertDeps.saveField).toHaveBeenCalledWith('ABC-1', 'description', 'orig desc');
    expect(revertDeps.saveField).toHaveBeenCalledWith('ABC-1', AC_FIELD, 'orig ac');
    expect(result.items[0].state).toBe('reverted');
  });

  it('restores the summary too when somebody renamed it and the operator reverts anyway', async () => {
    // All three fields go back TOGETHER: a Feature left with its old description and a new summary
    // is a state that never existed and nobody asked for.
    const revertDeps = deps({ fetchLive: vi.fn(async () => whatToolboxWrote({ summary: 'Renamed by the PO' })) });
    const result = await revertItems(
      batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1'], { revertAnywayKeys: ['ABC-1'] },
    );

    expect(revertDeps.saveField).toHaveBeenCalledWith('ABC-1', 'summary', 'Original summary');
    expect(result.items[0].state).toBe('reverted');
  });

  it('does not cry wolf over a field somebody already put back by hand', async () => {
    // Live differs from what Toolbox wrote, but only because it is already the original. Reverting
    // it discards nothing, and a warning here is the one that teaches people to click past the
    // warning that matters.
    const revertDeps = deps({ fetchLive: vi.fn(async () => whatToolboxWrote({ description: 'orig desc' })) });
    const result = await revertItems(batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1']);

    expect(result.items[0].state).toBe('reverted');
  });

  it('holds the revert and names what would have been lost', async () => {
    const revertDeps = deps({ fetchLive: vi.fn(async () => whatToolboxWrote({ description: 'a later edit' })) });
    const result = await revertItems(batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1']);

    expect(result.items[0].state).toBe('revert-blocked');
    expect(result.items[0].submitResult?.fieldErrors).toEqual(['Description']);
    expect(revertDeps.saveField).not.toHaveBeenCalled();
  });

  it('reverts anyway when the operator says so, having been told what it costs', async () => {
    const revertDeps = deps({ fetchLive: vi.fn(async () => whatToolboxWrote({ description: 'a later edit' })) });
    const result = await revertItems(
      batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1'], { revertAnywayKeys: ['ABC-1'] },
    );

    expect(result.items[0].state).toBe('reverted');
    expect(revertDeps.saveField).toHaveBeenCalledWith('ABC-1', 'description', 'orig desc');
  });

  it('reverts only the items asked for, leaving the rest of the batch alone', async () => {
    const revertDeps = deps();
    const result = await revertItems(
      batch([item('ABC-1', 'submitted'), item('ABC-2', 'submitted')]), CONTEXT, revertDeps, ['ABC-1'],
    );

    expect(result.items[0].state).toBe('reverted');
    expect(result.items[1].state).toBe('submitted');
  });

  it('refuses an item Toolbox never wrote, because there is nothing to undo', async () => {
    const revertDeps = deps();
    const result = await revertItems(batch([item('ABC-9', 'approved')]), CONTEXT, revertDeps, ['ABC-9']);

    expect(result.items[0].state).toBe('approved');
    expect(revertDeps.saveField).not.toHaveBeenCalled();
  });

  it('reports a write that failed rather than claiming the original is back', async () => {
    const revertDeps = deps({
      saveField: vi.fn(async (_key: string, fieldId: string) => {
        if (fieldId === 'description') throw new Error('field is not on the screen');
      }),
    });
    const result = await revertItems(batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1']);

    expect(result.items[0].state).toBe('failed');
    expect(result.items[0].submitResult?.ok).toBe(false);
  });

  it('carries on through the batch when one item fails', async () => {
    const revertDeps = deps({
      saveField: vi.fn(async (issueKey: string) => {
        if (issueKey === 'ABC-1') throw new Error('nope');
      }),
    });
    const result = await revertItems(
      batch([item('ABC-1', 'submitted'), item('ABC-2', 'submitted')]), CONTEXT, revertDeps, ['ABC-1', 'ABC-2'],
    );

    expect(result.items[0].state).toBe('failed');
    expect(result.items[1].state).toBe('reverted');
  });

  it('writes nothing at all when the issue already matches the snapshot', async () => {
    // Reverting an issue that is already back to its original is a no-op, not a write and not an error.
    const revertDeps = deps({ fetchLive: vi.fn(async () => captured()) });
    const result = await revertItems(batch([item('ABC-1', 'submitted')]), CONTEXT, revertDeps, ['ABC-1']);

    expect(result.items[0].state).toBe('reverted');
    expect(revertDeps.saveField).not.toHaveBeenCalled();
  });
});
