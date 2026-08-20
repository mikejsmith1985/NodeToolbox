// featureLinkInheritance.test.ts — Copying a Feature link from a linked sibling.
//
// The team splits one piece of work into a [DEV] story and an [SL] test story, links them, and puts
// the Feature link on the DEV one. The SL story is then flagged "missing feature link" forever: AI
// cannot help (a Feature link is a lookup, not a judgement) and typing it by hand means opening the
// sibling to read a value that is already one field away.

import { describe, expect, it } from 'vitest';

import {
  chooseInheritedFeatureLink,
  readSameProjectLinkedKeys,
} from './featureLinkInheritance.ts';
import type { JiraIssue } from './checks/hygieneChecks.ts';

function issueWithLinks(issueKey: string, linkedKeys: string[]): JiraIssue {
  return {
    key: issueKey,
    fields: {
      summary: '[SL] SL Test',
      issuelinks: linkedKeys.map((linkedKey) => ({
        type: { name: 'Relates' },
        outwardIssue: { key: linkedKey, fields: { summary: '[DEV] ' + linkedKey } },
      })),
    },
  } as unknown as JiraIssue;
}

describe('readSameProjectLinkedKeys', () => {
  it('returns linked issues that live in the same project', () => {
    expect(readSameProjectLinkedKeys(issueWithLinks('ENFCT-2042', ['ENFCT-2041']))).toEqual(['ENFCT-2041']);
  });

  it('leaves out a linked issue from another project', () => {
    // A Feature link copied out of another project's issue would point at that project's Feature.
    const issue = issueWithLinks('ENFCT-2042', ['ENFCT-2041', 'QEINT-610']);

    expect(readSameProjectLinkedKeys(issue)).toEqual(['ENFCT-2041']);
  });

  it('reads links in both directions', () => {
    const issue = {
      key: 'ENFCT-2042',
      fields: {
        issuelinks: [
          { type: { name: 'Relates' }, inwardIssue: { key: 'ENFCT-2040' } },
          { type: { name: 'Relates' }, outwardIssue: { key: 'ENFCT-2041' } },
        ],
      },
    } as unknown as JiraIssue;

    expect(readSameProjectLinkedKeys(issue)).toEqual(['ENFCT-2040', 'ENFCT-2041']);
  });

  it('never returns the issue itself, and never a duplicate', () => {
    const issue = issueWithLinks('ENFCT-2042', ['ENFCT-2041', 'ENFCT-2041', 'ENFCT-2042']);

    expect(readSameProjectLinkedKeys(issue)).toEqual(['ENFCT-2041']);
  });

  it('is empty for an issue with no links at all', () => {
    expect(readSameProjectLinkedKeys({ key: 'ENFCT-1', fields: {} } as unknown as JiraIssue)).toEqual([]);
  });
});

describe('chooseInheritedFeatureLink', () => {
  it('takes the Feature link when exactly one sibling carries one', () => {
    const choice = chooseInheritedFeatureLink([
      { issueKey: 'ENFCT-2041', featureLinkValue: 'ENFCT-1900' },
      { issueKey: 'ENFCT-2040', featureLinkValue: null },
    ]);

    expect(choice.featureLinkValue).toBe('ENFCT-1900');
    expect(choice.sourceIssueKey).toBe('ENFCT-2041');
  });

  it('takes the shared value when siblings agree', () => {
    const choice = chooseInheritedFeatureLink([
      { issueKey: 'ENFCT-2041', featureLinkValue: 'ENFCT-1900' },
      { issueKey: 'ENFCT-2040', featureLinkValue: 'ENFCT-1900' },
    ]);

    expect(choice.featureLinkValue).toBe('ENFCT-1900');
  });

  it('REFUSES when siblings name different Features', () => {
    // Guessing here writes a wrong Feature onto a story, which then misreports on the roll-up board
    // and every report built from it. Refusing leaves one flag; guessing corrupts the hierarchy.
    const choice = chooseInheritedFeatureLink([
      { issueKey: 'ENFCT-2041', featureLinkValue: 'ENFCT-1900' },
      { issueKey: 'ENFCT-2040', featureLinkValue: 'ENFCT-1877' },
    ]);

    expect(choice.featureLinkValue).toBeNull();
    expect(choice.declinedReason).toMatch(/disagree/i);
  });

  it('says so plainly when no sibling carries a Feature link', () => {
    const choice = chooseInheritedFeatureLink([{ issueKey: 'ENFCT-2041', featureLinkValue: null }]);

    expect(choice.featureLinkValue).toBeNull();
    expect(choice.declinedReason).toMatch(/no linked issue/i);
  });

  it('says so plainly when there are no siblings to read', () => {
    const choice = chooseInheritedFeatureLink([]);

    expect(choice.featureLinkValue).toBeNull();
    expect(choice.declinedReason).toMatch(/no linked issue/i);
  });
});
