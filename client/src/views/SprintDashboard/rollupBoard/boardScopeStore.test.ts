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
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC']);
  });

  it('lets one team track one project while another tracks two', () => {
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });
    saveTeamFeatureScope('cleanup-crew', { featureProjectKeys: ['ENCUC', 'DENP'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC']);
    expect(loadTeamFeatureScope('cleanup-crew').featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('treats an explicitly empty team list as "track everything", not as a typo to fall back from', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ featureProjectKeys: ['ENCUC'] }));
    saveTeamFeatureScope('transformers', { featureProjectKeys: [], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual([]);
  });

  it('remembers the issue-linked toggle', () => {
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: true, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

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
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

    expect(hasTeamOwnFeatureScope('transformers')).toBe(true);
  });
});

describe('saveTeamFeatureScope', () => {
  it('leaves other teams byte-identical', () => {
    saveTeamFeatureScope('cleanup-crew', { featureProjectKeys: ['ENCUC', 'DENP'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: true, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

    expect(loadTeamFeatureScope('cleanup-crew')).toEqual({
      featureProjectKeys: ['ENCUC', 'DENP'],
      shouldIncludeOutOfProjectFeatureLinks: false,
      shouldIncludeIssueLinkedFeatures: true, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '',
  excludedFeatureLabels: [], disciplineProjects: [],
    });
  });
});

describe('clearTeamFeatureScope', () => {
  it('puts a team back to inheriting the ART-wide setting', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ featureProjectKeys: ['ENCUC', 'DENP'] }));
    saveTeamFeatureScope('transformers', { featureProjectKeys: ['ENCUC'], shouldIncludeOutOfProjectFeatureLinks: false, shouldIncludeIssueLinkedFeatures: false, carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '', excludedFeatureLabels: [], disciplineProjects: [] });

    clearTeamFeatureScope('transformers');

    expect(hasTeamOwnFeatureScope('transformers')).toBe(false);
    expect(loadTeamFeatureScope('transformers').featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });
});

describe('disciplineProjects', () => {
  it('reads a scope saved before disciplines existed as having none', () => {
    // T-01: absent means never configured, not corrupt — and none means the whole sub-lane feature
    // is off, so an existing board is untouched by this shipping.
    window.localStorage.setItem('tbxRollupBoardScope', JSON.stringify({
      transformers: { featureProjectKeys: ['DENP'] },
    }));

    expect(loadTeamFeatureScope('transformers').disciplineProjects).toEqual([]);
  });

  it('round-trips disciplines in the order they were configured', () => {
    // Order matters: it decides each discipline's colour, so a reordered list would repaint the board.
    const disciplines = [
      { name: 'QE', featureProjectKey: 'QEINT', storyProjectKey: 'QEINT' },
      { name: 'BT', featureProjectKey: 'BTINT', storyProjectKey: 'BTINT' },
    ];
    saveTeamFeatureScope('transformers', {
      featureProjectKeys: ['DENP'],
      shouldIncludeOutOfProjectFeatureLinks: false,
      shouldIncludeIssueLinkedFeatures: false,
      carryOverPiValue: '',
      carryOverSource: 'none',
      teamFeatureLabel: '',
      excludedFeatureLabels: [],
      disciplineProjects: disciplines,
    });

    expect(loadTeamFeatureScope('transformers').disciplineProjects).toEqual(disciplines);
  });
});
