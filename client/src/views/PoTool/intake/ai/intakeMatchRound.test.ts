// intakeMatchRound.test.ts — Contract tests for the duplicate-verdict rule (spec 037, contracts/ai-rounds.md §2):
// only an item's own candidates can be chosen, always in the spelling Toolbox found.

import { describe, expect, it } from 'vitest';

import { createIntakeItem, type DuplicateCandidate, type IntakeItem } from '../epicIntakeModel.ts';
import { describeMatchVerdict, validateMatchVerdict } from './intakeMatchRound.ts';

function buildCandidate(key: string): DuplicateCandidate {
  return { key, summary: `Epic ${key}`, statusName: 'In Progress', statusCategory: 'indeterminate', descriptionExcerpt: '', foundBy: 'search' };
}

function buildItem(candidateKeys: string[]): IntakeItem {
  return { ...createIntakeItem(1, 'Item 1', [1]), candidates: candidateKeys.map(buildCandidate) };
}

describe('validateMatchVerdict', () => {
  it('accepts a key from the item\'s own list, in the list\'s spelling', () => {
    expect(validateMatchVerdict({ verdict: 'Existing', key: ' denp-632 ' }, buildItem(['DENP-632']))).toEqual({ verdict: 'existing', key: 'DENP-632' });
  });

  it('refuses a key the item was not given, naming it', () => {
    expect(validateMatchVerdict({ verdict: 'existing', key: 'DENP-700' }, buildItem(['DENP-632']))).toBe('DENP-700 was not among the Epics found for item-1.');
    expect(validateMatchVerdict({ verdict: 'existing' }, buildItem(['DENP-632']))).toMatch(/^The key/);
  });

  it('accepts createNew with no key and refuses an unknown verdict', () => {
    expect(validateMatchVerdict({ verdict: 'createNew' }, buildItem([]))).toEqual({ verdict: 'createNew' });
    expect(validateMatchVerdict({ verdict: 'maybe' }, buildItem([]))).toMatch(/not a verdict/);
  });
});

describe('describeMatchVerdict', () => {
  it('describes each verdict in plain words', () => {
    expect(describeMatchVerdict({ verdict: 'existing', key: 'DENP-1' })).toBe('Matches DENP-1');
    expect(describeMatchVerdict({ verdict: 'createNew' })).toBe('No open Epic covers it');
    expect(describeMatchVerdict({ verdict: 'notActionable' })).toBe('Not actionable');
  });
});
