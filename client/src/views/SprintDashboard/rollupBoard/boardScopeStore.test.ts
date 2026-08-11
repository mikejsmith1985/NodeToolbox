// boardScopeStore.test.ts — Proves each team narrows its own board, and that turning this on
// changes nothing for a team that has not asked for it.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearTeamFeatureScope,
  hasTeamOwnFeatureScope,
  loadTeamFeatureScope,
  saveTeamFeatureScope,
} from './boardScopeStore.ts';

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadTeamFeatureScope', () => {
  it('inherits the ART-wide projects when a team has never configured its own', () => {
    // Nobody who has not asked for scoping should see their board change.
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ featureProjectKeys: ['ENCUC', 'DENP'] }));

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('leaves the board unfiltered when neither the team nor the ART has configured anything', () => {
    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual([]);
  });

  it('prefers the team\'s own narrower list over the ART-wide one', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ featureProjectKeys: ['ENCUC', 'DENP', 'OTHER'] }));
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC']);
  });

  it('lets one team track one project while another tracks two', () => {
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });
    saveTeamFeatureScope('cleanup-crew', { featureProjectKeys: ['ENCUC', 'DENP'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC']);
    expect(loadTeamFeatureScope('cleanup-crew').featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('treats an explicitly empty team list as "track everything", not as a typo to fall back from', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ featureProjectKeys: ['ENCUC'] }));
    saveTeamFeatureScope('transformers', { featureProjectKeys: [], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual([]);
  });

  it('remembers the issue-linked toggle', () => {
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: true, carryOverPiValue: '' });

    expect(loadTeamFeatureScope('transformers').shouldIncludeIssueLinkedFeatures).toBe(true);
  });

  it('defaults BOTH toggles off, so the project list genuinely narrows the board', () => {
    // With either defaulting on, "Apply" would appear to do nothing on a real board.
    expect(loadTeamFeatureScope('transformers').shouldIncludeIssueLinkedFeatures).toBe(false);
    expect(loadTeamFeatureScope('transformers').shouldIncludeOutOfProjectFeatureLinks).toBe(false);
  });

  it('treats unreadable storage as nothing stored rather than throwing', () => {
    window.localStorage.setItem('tbxRollupBoardScope', 'not json');

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual([]);
  });
});

describe('hasTeamOwnFeatureScope', () => {
  it('is false while a team is still inheriting', () => {
    expect(hasTeamOwnFeatureScope('transformers')).toBe(false);
  });

  it('is true once the team has set its own', () => {
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });

    expect(hasTeamOwnFeatureScope('transformers')).toBe(true);
  });
});

describe('saveTeamFeatureScope', () => {
  it('leaves other teams byte-identical', () => {
    saveTeamFeatureScope('cleanup-crew', { featureProjectKeys: ['ENCUC', 'DENP'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: true, carryOverPiValue: '' });
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });

    expect(loadTeamFeatureScope('cleanup-crew')).toEqual({
      featureProjectKeys: ['ENCUC', 'DENP'],
      shouldIncludeOutOfProjectFeatureLinks: false,
      shouldIncludeIssueLinkedFeatures: true, carryOverPiValue: '',
    });
  });
});

describe('clearTeamFeatureScope', () => {
  it('puts a team back to inheriting the ART-wide setting', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ featureProjectKeys: ['ENCUC', 'DENP'] }));
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '' });

    clearTeamFeatureScope('transformers');

    expect(hasTeamOwnFeatureScope('transformers')).toBe(false);
    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });
});
