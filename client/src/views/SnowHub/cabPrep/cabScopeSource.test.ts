// cabScopeSource.test.ts — Which Jira issues a CAB pack draws its context from.

import { describe, expect, it } from 'vitest';

import {
  readJiraKeysFromChange,
  readJiraKeysFromText,
  readRejectedIssueKeys,
  readTypedIssueKeys,
} from './cabScopeSource.ts';

describe('readJiraKeysFromText', () => {
  it('finds the keys the create flow wrote into a description', () => {
    // The only trace ServiceNow keeps of a change's Jira work.
    const keys = readJiraKeysFromText('Deploys ENCUC-2213 and ENCUC-2358 to production.');

    expect(keys).toEqual(['ENCUC-2213', 'ENCUC-2358']);
  });

  it('lists each key once, however often it is mentioned', () => {
    expect(readJiraKeysFromText('ENCUC-1 ... see ENCUC-1 above')).toEqual(['ENCUC-1']);
  });

  it('requires the hyphen, because a description is prose', () => {
    // "ENCUC 2213" in a sentence is far more likely to be words than a key. The Confluence title
    // scanner tolerates the space form on purpose; this one must not.
    expect(readJiraKeysFromText('Rolls ENCUC 2213 forward')).toEqual([]);
  });

  it('does not read a key out of a lower-case word followed by a number', () => {
    // "step-1" and "phase-2" would otherwise become keys that fail to fetch and look like a broken
    // scope.
    expect(readJiraKeysFromText('Run step-1 then phase-2.')).toEqual([]);
  });

  it('finds a key inside punctuation', () => {
    expect(readJiraKeysFromText('(ENCUC-2213), [ENCUC-2358].')).toEqual(['ENCUC-2213', 'ENCUC-2358']);
  });

  it('finds nothing in text that names nothing', () => {
    expect(readJiraKeysFromText('Routine configuration update.')).toEqual([]);
    expect(readJiraKeysFromText('')).toEqual([]);
  });
});

describe('readJiraKeysFromChange', () => {
  it('reads the short description as well as the description', () => {
    // A small change sometimes names its only issue in the title and nowhere else.
    const keys = readJiraKeysFromChange('Enrollment - ENCUC-2213 uplift', 'No further detail.');

    expect(keys).toEqual(['ENCUC-2213']);
  });

  it('merges both without repeating a key named in each', () => {
    const keys = readJiraKeysFromChange('ENCUC-2213 uplift', 'Deploys ENCUC-2213 and ENCUC-2358.');

    expect(keys).toEqual(['ENCUC-2213', 'ENCUC-2358']);
  });
});

describe('readTypedIssueKeys', () => {
  it('accepts whatever separator came to hand', () => {
    // This field is filled by pasting from Jira, a spreadsheet, or a chat message.
    expect(readTypedIssueKeys('ENCUC-1, ENCUC-2\nENCUC-3  ENCUC-4;ENCUC-5'))
      .toEqual(['ENCUC-1', 'ENCUC-2', 'ENCUC-3', 'ENCUC-4', 'ENCUC-5']);
  });

  it('upper-cases what was typed, so a lower-case paste still matches Jira', () => {
    expect(readTypedIssueKeys('encuc-2213')).toEqual(['ENCUC-2213']);
  });

  it('drops an entry that is not a key rather than sending it', () => {
    // A malformed key fails the whole fetch in some Jira versions and takes the good ones with it.
    expect(readTypedIssueKeys('ENCUC-1, not-a-key, ENCUC-2')).toEqual(['ENCUC-1', 'ENCUC-2']);
  });

  it('lists each key once however many times it was pasted', () => {
    expect(readTypedIssueKeys('ENCUC-1 ENCUC-1')).toEqual(['ENCUC-1']);
  });

  it('returns nothing for an empty field', () => {
    expect(readTypedIssueKeys('')).toEqual([]);
    expect(readTypedIssueKeys('   ')).toEqual([]);
  });
});

describe('readRejectedIssueKeys', () => {
  it('names what was dropped, so a silent drop is never silent', () => {
    expect(readRejectedIssueKeys('ENCUC-1, banana, ENCUC-2')).toEqual(['banana']);
  });

  it('names nothing when every entry was usable', () => {
    expect(readRejectedIssueKeys('ENCUC-1 ENCUC-2')).toEqual([]);
  });
});
