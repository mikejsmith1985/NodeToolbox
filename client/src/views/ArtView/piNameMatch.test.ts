// piNameMatch.test.ts — Whether a hand-typed PI name finds the PI Jira actually holds.
//
// A PI Review page's PI name is typed by a person. The value it is matched against comes from Jira,
// and Jira's carries the window: "PI 26.4 (07/30/26 - 10/07/26)". Compared as whole strings those
// two never match, so the page silently disappears from its own PI — and a legacy page belonging to
// a DIFFERENT PI gets adopted in its place, which is how a 26.4 board ends up on the 26.3 page.

import { describe, expect, it } from 'vitest';

import { doPiNamesMatch, readPiIdentifier } from './piNameMatch.ts';

describe('readPiIdentifier', () => {
  it('drops the window Jira appends, keeping what actually names the PI', () => {
    expect(readPiIdentifier('PI 26.4 (07/30/26 - 10/07/26)')).toBe('26.4');
  });

  it('leaves a name that carries no window alone', () => {
    expect(readPiIdentifier('PI 26.4')).toBe('26.4');
  });

  it('ignores case and surrounding space, which people type inconsistently', () => {
    expect(readPiIdentifier('  pi 26.4  ')).toBe('26.4');
  });

  it('collapses runs of space, so "PI  26.4" is the same PI', () => {
    expect(readPiIdentifier('PI  26.4')).toBe('26.4');
  });

  it('keeps an empty name empty, which is what marks a page as belonging to no PI', () => {
    expect(readPiIdentifier('   ')).toBe('');
  });
});

describe('doPiNamesMatch', () => {
  it('matches a typed PI against the same PI carrying its window', () => {
    expect(doPiNamesMatch('PI 26.4', 'PI 26.4 (07/30/26 - 10/07/26)')).toBe(true);
  });

  it('matches when it is the stored name that carries the window', () => {
    expect(doPiNamesMatch('PI 26.4 (07/30/26 - 10/07/26)', 'PI 26.4')).toBe(true);
  });

  it('still refuses a DIFFERENT PI, which is the whole point of matching at all', () => {
    // The failure being fixed made 26.3 stand in for 26.4. Loosening the comparison must not make
    // that correct rather than accidental.
    expect(doPiNamesMatch('PI 26.3', 'PI 26.4 (07/30/26 - 10/07/26)')).toBe(false);
    expect(doPiNamesMatch('PI 26.4', 'PI 26.40')).toBe(false);
  });

  it('treats an empty name as matching nothing, never everything', () => {
    expect(doPiNamesMatch('', 'PI 26.4')).toBe(false);
    expect(doPiNamesMatch('PI 26.4', '')).toBe(false);
  });

  it('matches two windowed names whose windows were typed differently', () => {
    expect(doPiNamesMatch('PI 26.4 (7/30/26 - 10/7/26)', 'PI 26.4 (07/30/26 - 10/07/26)')).toBe(true);
  });
});

describe('the "PI" prefix people do and do not type', () => {
  it('matches a page saved as "26.4" against Jira "PI 26.4 (...)"', () => {
    // People type the PI several ways. The one thing every spelling shares is the number, and that
    // is the part that actually identifies the Increment.
    expect(doPiNamesMatch('26.4', 'PI 26.4 (07/30/26 - 10/07/26)')).toBe(true);
  });

  it('matches "PI26.4" written without the space', () => {
    expect(doPiNamesMatch('PI26.4', 'PI 26.4')).toBe(true);
  });

  it('still refuses a different Increment however it is spelled', () => {
    expect(doPiNamesMatch('26.3', 'PI 26.4')).toBe(false);
    expect(doPiNamesMatch('PI26.3', '26.4')).toBe(false);
  });

  it('does not strip a "PI" that is part of a real name', () => {
    // "PIVOT" is not a PI prefix. Stripping letters rather than the whole word would make it one.
    expect(doPiNamesMatch('PIVOT 1', 'PI VOT 1')).toBe(false);
  });
});
