// cloneFamily.test.ts — Proves the board can tell another discipline's copy from its own peer.
//
// The whole feature turns on one distinction that a real Feature's Issue Links panel makes plain:
//
//     is cloned by   DENP-1359   ← the dev team's OWN project: a peer, keeps its own top-level lane
//     is cloned by   QEINT-610   ← QE's project: a sub-lane
//
// A design keyed on "has a Cloners link" would have nested a sibling Feature under its own sibling.

import { describe, expect, it } from 'vitest';

import {
  classifyClone,
  readCloneAttribution,
  describeUnconfiguredClones,
  findCloneByFeatureName,
  readCloneLinks,
  readDisciplineToneIndex,
} from './cloneFamily.ts';
import type { DisciplineProjects } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const DEV_PROJECTS = ['DENP'];

const QE: DisciplineProjects = { name: 'QE', featureProjectKey: 'QEINT', storyProjectKeys: ['QEINT'] };
const BT: DisciplineProjects = { name: 'BT', featureProjectKey: 'BTINT', storyProjectKeys: ['BTINT'] };

/** Builds a Feature carrying the clone links exactly as Jira returns them. */
function buildFeature(key: string, issuelinks: unknown[] = [], extraFields: Record<string, unknown> = {}): JiraIssue {
  return { id: key, key, fields: { summary: `${key} summary`, issuelinks, ...extraFields } } as unknown as JiraIssue;
}

/** The link shape Jira returns when THIS issue is the original. */
function clonedByLink(otherKey: string) {
  return {
    type: { name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
    outwardIssue: { key: otherKey },
  };
}

/** The same relationship recorded from the other side. */
function clonesLink(otherKey: string) {
  return {
    type: { name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
    inwardIssue: { key: otherKey },
  };
}

describe('readCloneLinks', () => {
  it('finds every clone named on the Feature', () => {
    const links = readCloneLinks(buildFeature('DENP-1353', [clonedByLink('DENP-1359'), clonedByLink('QEINT-610')]));

    expect(links.map((link) => link.cloneIssueKey)).toEqual(['DENP-1359', 'QEINT-610']);
  });

  it('reads the link whichever side Jira recorded it on', () => {
    // C-02: which end holds the link depends on who pressed Clone, and a family that appears or
    // disappears based on that is not a family.
    expect(readCloneLinks(buildFeature('QEINT-610', [clonesLink('DENP-1353')]))[0].cloneIssueKey)
      .toBe('DENP-1353');
  });

  it('ignores links that are not clones', () => {
    const relates = { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'DENP-9' } };

    expect(readCloneLinks(buildFeature('DENP-1353', [relates]))).toEqual([]);
  });

  it('reads nothing from a Feature that could not be loaded', () => {
    expect(readCloneLinks(null)).toEqual([]);
  });

  it('never returns the same clone twice, however many links name it', () => {
    const links = readCloneLinks(buildFeature('DENP-1353', [clonedByLink('QEINT-610'), clonesLink('QEINT-610')]));

    expect(links).toHaveLength(1);
  });
});

describe('classifyClone — the project decides, not the link', () => {
  it('calls a clone in the dev team\'s own project a peer, not a discipline', () => {
    // C-01, and the single most important assertion in this file.
    expect(classifyClone('DENP-1359', 'cloners-link', DEV_PROJECTS, [QE, BT]))
      .toEqual({ kind: 'peer', cloneIssueKey: 'DENP-1359' });
  });

  it('calls a clone in a configured discipline project a sub-lane', () => {
    const classification = classifyClone('QEINT-610', 'cloners-link', DEV_PROJECTS, [QE, BT]);

    expect(classification.kind).toBe('discipline');
    expect(classification.kind === 'discipline' && classification.discipline.name).toBe('QE');
  });

  it('reports a clone in a project nobody configured, rather than dropping it', () => {
    const classification = classifyClone('BTINT-77', 'cloners-link', DEV_PROJECTS, [QE]);

    expect(classification).toEqual({ kind: 'unconfigured', cloneIssueKey: 'BTINT-77', projectKey: 'BTINT' });
  });

  it('never invents a discipline when none are configured', () => {
    // C-04: with the feature switched off, nothing may become a sub-lane.
    for (const cloneKey of ['DENP-1359', 'QEINT-610']) {
      expect(classifyClone(cloneKey, 'cloners-link', DEV_PROJECTS, []).kind).not.toBe('discipline');
    }
  });

  it('prefers peer over discipline when a team has configured its own project by mistake', () => {
    const selfConfigured: DisciplineProjects = { name: 'Oops', featureProjectKey: 'DENP', storyProjectKeys: ['DENP'] };

    expect(classifyClone('DENP-1359', 'cloners-link', DEV_PROJECTS, [selfConfigured]).kind).toBe('peer');
  });

  it('matches project keys whatever case they were typed in', () => {
    expect(classifyClone('qeint-610', 'cloners-link', ['denp'], [QE]).kind).toBe('discipline');
  });
});

describe('findCloneByFeatureName — the net, not the plan', () => {
  const DEV = buildFeature('DENP-1353', [], { summary: 'H Contract Migration' });

  it('matches an identical title inside a configured discipline project', () => {
    const candidates = [buildFeature('QEINT-610', [], { summary: 'H Contract Migration' })];

    expect(findCloneByFeatureName(DEV, candidates, [QE])[0].evidence).toBe('feature-name-match');
  });

  it('ignores an identical title outside the configured projects', () => {
    // C-05: a name match across Jira at large would invent families constantly.
    const candidates = [buildFeature('OTHER-1', [], { summary: 'H Contract Migration' })];

    expect(findCloneByFeatureName(DEV, candidates, [QE])).toEqual([]);
  });

  it('matches after trimming and regardless of case', () => {
    const candidates = [buildFeature('QEINT-610', [], { summary: '  h contract migration  ' })];

    expect(findCloneByFeatureName(DEV, candidates, [QE])).toHaveLength(1);
  });

  it('does not match a title that merely shares a prefix', () => {
    // C-07: exact only. The sampled QE clone's title shares almost no words with its original, so a
    // loose match would find the wrong Feature far more often than the right one.
    const candidates = [buildFeature('QEINT-610', [], { summary: 'H Contract Migration - Oklahoma 1/1/2027' })];

    expect(findCloneByFeatureName(DEV, candidates, [QE])).toEqual([]);
  });

  it('prefers the Feature Name field over the summary when the instance has one', () => {
    const devWithName = buildFeature('DENP-1353', [], { summary: 'ignored', customfield_20: 'Real Name' });
    const candidates = [buildFeature('QEINT-610', [], { summary: 'also ignored', customfield_20: 'Real Name' })];

    expect(findCloneByFeatureName(devWithName, candidates, [QE], 'customfield_20')).toHaveLength(1);
  });

  it('finds nothing when no disciplines are configured', () => {
    expect(findCloneByFeatureName(DEV, [buildFeature('QEINT-610', [], { summary: 'H Contract Migration' })], []))
      .toEqual([]);
  });
});

describe('readDisciplineToneIndex', () => {
  it('gives each discipline its own tone', () => {
    expect(readDisciplineToneIndex(QE, [QE, BT])).not.toBe(readDisciplineToneIndex(BT, [QE, BT]));
  });

  it('returns the same tone every time, so a discipline does not change colour on reload', () => {
    // C-08 / US2 scenario 2.
    expect(readDisciplineToneIndex(BT, [QE, BT])).toBe(readDisciplineToneIndex(BT, [QE, BT]));
  });

  it('falls back to the first tone for a discipline not in the list', () => {
    expect(readDisciplineToneIndex(BT, [QE])).toBe(0);
  });
});

describe('describeUnconfiguredClones', () => {
  it('says nothing when every clone was understood', () => {
    expect(describeUnconfiguredClones([{ kind: 'peer', cloneIssueKey: 'DENP-1359' }])).toBe('');
  });

  it('names the clones and the projects they sit in', () => {
    const sentence = describeUnconfiguredClones([
      { kind: 'unconfigured', cloneIssueKey: 'BTINT-77', projectKey: 'BTINT' },
      { kind: 'peer', cloneIssueKey: 'DENP-1359' },
    ]);

    expect(sentence).toContain('BTINT-77');
    expect(sentence).toContain('Board setup');
  });
});

describe('readCloneAttribution', () => {
  const CLONES = new Set(['QEINT-608']);
  const FIELDS = ['customfield_10108', 'customfield_10100'];

  it('reads the Feature Link, the way the dev team wires its work', () => {
    const issue = { fields: { customfield_10108: { key: 'QEINT-608' } } };

    expect(readCloneAttribution(issue, CLONES, FIELDS)).toBe('QEINT-608');
  });

  it('reads the portfolio Parent Link, the way QE wires its INTTEST work', () => {
    // The case that made every QE sub-lane read "has not broken its work down yet": the issues were
    // fetched and then discarded, because only the Feature Link was consulted.
    const issue = { fields: { customfield_10100: 'QEINT-608' } };

    expect(readCloneAttribution(issue, CLONES, FIELDS)).toBe('QEINT-608');
  });

  it('falls back to a sub-task parent, which carries no custom field at all', () => {
    const issue = { fields: { parent: { key: 'QEINT-608' } } };

    expect(readCloneAttribution(issue, CLONES, FIELDS)).toBe('QEINT-608');
  });

  it('claims nothing for an issue pointing at a Feature that is not one of these clones', () => {
    const issue = { fields: { customfield_10108: { key: 'DENP-1400' } } };

    expect(readCloneAttribution(issue, CLONES, FIELDS)).toBeNull();
  });

  it('claims nothing for an issue with no linkage at all', () => {
    expect(readCloneAttribution({ fields: {} }, CLONES, FIELDS)).toBeNull();
  });
});
