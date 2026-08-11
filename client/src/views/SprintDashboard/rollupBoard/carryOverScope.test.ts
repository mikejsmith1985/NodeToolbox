// carryOverScope.test.ts — Proves last PI's unfinished work can reach this PI's board.
//
// A Feature that did not finish keeps its original PI in Jira, because rewriting it would falsify what
// the ART committed last PI. So a board scoped to the current PI cannot see it, nor the child stories
// that also still carry the old PI — while the team works it now.

import { describe, expect, it } from 'vitest';

import {
  buildCarryOverFeatureJql,
  buildCarryOverWorkJql,
  describeCarryOverScope,
  mergeScopedIssueKeys,
} from './carryOverScope.ts';

const PREVIOUS_PI = 'PI 26.3 (04/22/26 - 07/29/26)';

describe('buildCarryOverFeatureJql — last PI, and only what never finished', () => {
  it('asks for unfinished Features in the named PI, within the team\'s Feature projects', () => {
    expect(buildCarryOverFeatureJql(['DENP'], PREVIOUS_PI, 'cf[10301]')).toBe(
      'issuetype = Feature AND project in ("DENP") AND cf[10301] = '
      + '"PI 26.3 (04/22/26 - 07/29/26)" AND statusCategory != Done ORDER BY key ASC',
    );
  });

  it('excludes finished Features, which were delivered rather than carried', () => {
    expect(buildCarryOverFeatureJql(['DENP'], PREVIOUS_PI, 'cf[10301]')).toContain('statusCategory != Done');
  });

  it('covers every configured Feature project', () => {
    expect(buildCarryOverFeatureJql(['ENCUC', 'DENP'], PREVIOUS_PI, 'cf[10301]'))
      .toContain('project in ("ENCUC", "DENP")');
  });

  it('returns null when no carry-over PI has been chosen, so nothing is pulled in by accident', () => {
    expect(buildCarryOverFeatureJql(['DENP'], '   ', 'cf[10301]')).toBeNull();
  });

  it('returns null with no Feature project configured', () => {
    expect(buildCarryOverFeatureJql([], PREVIOUS_PI, 'cf[10301]')).toBeNull();
  });

  it('returns null when the instance has no PI field', () => {
    expect(buildCarryOverFeatureJql(['DENP'], PREVIOUS_PI, '')).toBeNull();
  });

  it('escapes a quote in the PI name rather than breaking out of the string', () => {
    expect(buildCarryOverFeatureJql(['DENP'], 'PI "odd"', 'cf[10301]')).toContain('\\"odd\\"');
  });
});

describe('buildCarryOverWorkJql — the children, whatever PI they carry', () => {
  it('asks for everything linked to those Features', () => {
    expect(buildCarryOverWorkJql(['DENP-1', 'DENP-2'], 'cf[10108]'))
      .toBe('cf[10108] in (DENP-1, DENP-2) ORDER BY key ASC');
  });

  it('puts NO PI clause on the children', () => {
    // A carried-over Feature's children may hold the old PI, the new one, or none. All three are the
    // same work, and filtering by PI here would reintroduce the blindness this exists to remove.
    expect(buildCarryOverWorkJql(['DENP-1'], 'cf[10108]')).not.toContain('cf[10301]');
  });

  it('returns null when there are no carried-over Features to ask about', () => {
    expect(buildCarryOverWorkJql([], 'cf[10108]')).toBeNull();
  });

  it('returns null when the instance has no Feature Link field', () => {
    expect(buildCarryOverWorkJql(['DENP-1'], '')).toBeNull();
  });
});

describe('mergeScopedIssueKeys — added, never double-counted', () => {
  it('adds carried-over work to the PI\'s own scope', () => {
    expect(mergeScopedIssueKeys(['ENCUC-1'], ['ENCUC-9'])).toEqual(['ENCUC-1', 'ENCUC-9']);
  });

  it('counts a child already tagged to the current PI exactly once', () => {
    expect(mergeScopedIssueKeys(['ENCUC-1', 'ENCUC-2'], ['ENCUC-2', 'ENCUC-9']))
      .toEqual(['ENCUC-1', 'ENCUC-2', 'ENCUC-9']);
  });

  it('leaves the scope alone when nothing was carried over', () => {
    expect(mergeScopedIssueKeys(['ENCUC-1'], [])).toEqual(['ENCUC-1']);
  });

  it('works from an empty current scope', () => {
    expect(mergeScopedIssueKeys([], ['ENCUC-9'])).toEqual(['ENCUC-9']);
  });
});

describe('describeCarryOverScope — the board never silently shows more than its PI', () => {
  it('names the Features and counts their issues', () => {
    const sentence = describeCarryOverScope({
      featureKeys: ['DENP-1', 'DENP-2'], issueKeys: ['ENCUC-1', 'ENCUC-2', 'ENCUC-3'], fromPiValue: 'PI 26.3',
    });

    expect(sentence).toContain('2 unfinished Features carried over from PI 26.3');
    expect(sentence).toContain('3 of their issues');
    expect(sentence).toContain('DENP-1, DENP-2');
  });

  it('uses the singular for one Feature', () => {
    expect(describeCarryOverScope({ featureKeys: ['DENP-1'], issueKeys: [], fromPiValue: 'PI 26.3' }))
      .toContain('1 unfinished Feature carried');
  });

  it('says nothing at all when nothing was carried over', () => {
    expect(describeCarryOverScope({ featureKeys: [], issueKeys: [], fromPiValue: 'PI 26.3' })).toBe('');
  });
});
