// gh387Notes.fixture.test.ts — Guards the GH #387 fixture itself: every intake test assumes it is the real notes,
// verbatim, with Outlook's tab-separated bullets intact. If someone "tidies" it, these fail before the others mislead.

import { describe, expect, it } from 'vitest';

import { GH387_NOTES_TEXT } from './gh387Notes.fixture.ts';

/** The number of top-level bullet lines in the notes as pasted from Outlook. */
const EXPECTED_TOP_LEVEL_BULLET_COUNT = 26;

describe('GH #387 notes fixture', () => {
  it('keeps every top-level bullet with its tab marker', () => {
    const topLevelLines = GH387_NOTES_TEXT.split('\n').filter((line) => line.startsWith('•\t'));
    expect(topLevelLines).toHaveLength(EXPECTED_TOP_LEVEL_BULLET_COUNT);
  });

  it('keeps the Core Integration block and its stated sizes exactly', () => {
    expect(GH387_NOTES_TEXT).toContain('•\tCore Integration (denp-632)\no\t(1.2M) XL Enrollment\no\tFulfillment M\no\tInfra XL\no\tFacets M');
  });

  it('keeps the headings that are not items', () => {
    expect(GH387_NOTES_TEXT).toContain('\nNew Since OnSite\n');
    expect(GH387_NOTES_TEXT).toContain('\nNotes from OnSite\n');
  });
});
