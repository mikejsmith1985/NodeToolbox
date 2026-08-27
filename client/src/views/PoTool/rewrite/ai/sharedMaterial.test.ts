// sharedMaterial.test.ts — One set of documents, many Features.
//
// The batch could only ever re-write an issue from its OWN text, which is exactly backwards for the
// job people actually have: a new standard, a compliance note, a design decision — one document that
// changes a dozen Features at once. Without it the PO pasted the same material into a dozen separate
// runs and hoped they came back consistent.
//
// The rule that makes it work is unglamorous: the material has to appear in EVERY prompt part. A
// batch too large for one prompt is split, and shared material carried only in part one would leave
// every issue after the split re-written from nothing.

import { describe, expect, it } from 'vitest';

import { buildSharedMaterialBlock, MAX_SHARED_MATERIAL_CHARS } from './sharedMaterial.ts';
import type { ReferencedSource } from '../../sources/sourceModel.ts';

function pasteSource(id: string, label: string, text: string): ReferencedSource {
  return { kind: 'paste', id, label, text };
}

function confluenceSource(id: string, title: string, text: string): ReferencedSource {
  return {
    kind: 'confluence',
    id,
    title,
    pageUrl: `https://example.atlassian.net/wiki/pages/${id}`,
    pageId: id,
    text,
    fetchedAtIso: '2026-08-21T00:00:00.000Z',
  };
}

describe('buildSharedMaterialBlock', () => {
  it('is empty when there is no shared material, so nothing changes for a batch without it', () => {
    expect(buildSharedMaterialBlock([])).toBe('');
  });

  it('names each document, so the assistant can cite which one drove a change', () => {
    const block = buildSharedMaterialBlock([confluenceSource('1', 'Accessibility Standard', 'Contrast must be 4.5:1.')]);

    expect(block).toContain('Accessibility Standard');
    expect(block).toContain('Contrast must be 4.5:1.');
  });

  it('says plainly that the material applies to every issue in the prompt', () => {
    // Without this the assistant reads it as context for whichever issue happens to be first.
    const block = buildSharedMaterialBlock([pasteSource('1', 'Note', 'text')]);
    expect(block).toMatch(/applies to EVERY issue/i);
  });

  it('keeps several documents apart rather than running them together', () => {
    const block = buildSharedMaterialBlock([
      pasteSource('1', 'Compliance note', 'first body'),
      pasteSource('2', 'Design decision', 'second body'),
    ]);

    expect(block).toContain('Compliance note');
    expect(block).toContain('Design decision');
    expect(block.indexOf('first body')).toBeLessThan(block.indexOf('Design decision'));
  });

  it('caps the whole block and says it was cut, rather than crowding out the issues', () => {
    // A 200-page standard must not leave no room for the work being re-written. Truncation is
    // stated, never silent: a prompt that quietly dropped half its material would produce
    // re-writes nobody could account for.
    const block = buildSharedMaterialBlock([pasteSource('1', 'Huge', 'x'.repeat(MAX_SHARED_MATERIAL_CHARS * 2))]);

    expect(block.length).toBeLessThan(MAX_SHARED_MATERIAL_CHARS + 500);
    expect(block).toMatch(/truncated/i);
  });

  it('shares the budget across documents rather than letting the first one take it all', () => {
    const block = buildSharedMaterialBlock([
      pasteSource('1', 'First', 'a'.repeat(MAX_SHARED_MATERIAL_CHARS)),
      pasteSource('2', 'Second', 'b'.repeat(MAX_SHARED_MATERIAL_CHARS)),
    ]);

    // The second document is still present — being listed second must not mean being dropped.
    expect(block).toContain('Second');
    expect(block).toContain('b');
  });

  it('skips a document with no readable text rather than announcing an empty heading', () => {
    const block = buildSharedMaterialBlock([pasteSource('1', 'Empty', '   ')]);
    expect(block).toBe('');
  });
});

describe('buildSharedMaterialBlock — a consolidated brief', () => {
  const brief = {
    overview: 'Billing moves from LIS to consolidated statements.',
    decisions: [{ text: 'Consolidated statements', sourceTitles: ['Billing Grid'] }],
    requirements: [],
    openQuestions: [],
    conflicts: [],
    extractCount: 31,
    builtAtIso: '2026-08-27T00:00:00.000Z',
  };

  it('REPLACES the raw documents rather than joining them', () => {
    // A corpus that did not fit is now a block that does; pasting the originals back in beside it
    // would restore the exact problem the consolidation just solved.
    const block = buildSharedMaterialBlock([pasteSource('paste-1', 'Billing Grid', 'the whole raw notebook page')], brief);

    expect(block).toContain('Consolidated statements');
    expect(block).not.toContain('the whole raw notebook page');
  });

  it('says how many documents stand behind it', () => {
    expect(buildSharedMaterialBlock([], brief)).toContain('31 documents');
  });

  it('still says the material applies to every issue, not just the first', () => {
    expect(buildSharedMaterialBlock([], brief)).toContain('EVERY issue');
  });

  it('falls back to the raw documents when no brief has been built', () => {
    const block = buildSharedMaterialBlock([pasteSource('paste-1', 'Billing Grid', 'raw text')], null);

    expect(block).toContain('raw text');
  });
});
