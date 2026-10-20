// prbJiraPlan.test.ts — Proves a ServiceNow problem becomes exactly three Jira drafts that all point back at it.

import { describe, expect, it } from 'vitest';

import {
  buildPrbJiraDrafts,
  buildPrbLabel,
  buildPrbRecordLink,
  buildPrbRoleLabel,
  MISSING_DESCRIPTION_TEXT,
  readRoleFromLabels,
} from './prbJiraPlan.ts';

const PROBLEM = {
  number: 'PRB0012345',
  shortDescription: 'Login page times out',
  description: 'Users wait 60 seconds then see an error.',
  link: 'https://snow.example.com/problem.do?sysparm_query=number%3DPRB0012345',
};

describe('buildPrbJiraDrafts', () => {
  it('makes a Defect, an SL Story and a QE Story, in that order, all in the chosen project and Epic', () => {
    const drafts = buildPrbJiraDrafts(PROBLEM, 'EPIC-7', 'ENCUC');
    expect(drafts.map((draft) => draft.role)).toEqual(['defect', 'sl', 'qe']);
    expect(drafts.map((draft) => draft.issueTypeName)).toEqual(['Defect', 'Story', 'Story']);
    expect(drafts.every((draft) => draft.projectKey === 'ENCUC' && draft.epicKey === 'EPIC-7')).toBe(true);
  });

  it('names each item the agreed way', () => {
    const [defect, slStory, qeStory] = buildPrbJiraDrafts(PROBLEM, 'EPIC-7', 'ENCUC');
    expect(defect.summary).toBe('PRB0012345 — Login page times out');
    expect(slStory.summary).toBe('SL: Login page times out');
    expect(qeStory.summary).toBe('QE: Login page times out');
  });

  it('puts the problem number and its link in every description', () => {
    for (const draft of buildPrbJiraDrafts(PROBLEM, 'EPIC-7', 'ENCUC')) {
      expect(draft.description).toContain('PRB0012345');
      expect(draft.description).toContain(PROBLEM.link);
    }
  });

  it('labels all three with the problem label and their own role label', () => {
    const drafts = buildPrbJiraDrafts(PROBLEM, 'EPIC-7', 'ENCUC');
    expect(drafts[0].labels).toEqual(['prb-prb0012345', 'prb-prb0012345-defect']);
    expect(drafts[1].labels).toEqual(['prb-prb0012345', 'prb-prb0012345-sl']);
    expect(drafts[2].labels).toEqual(['prb-prb0012345', 'prb-prb0012345-qe']);
  });

  it('fills a gap with a highlighted placeholder when the problem has no description', () => {
    const [defect] = buildPrbJiraDrafts({ ...PROBLEM, description: '  ' }, 'EPIC-7', 'ENCUC');
    expect(defect.description).toContain(MISSING_DESCRIPTION_TEXT);
    expect(defect.isSourceDescriptionMissing).toBe(true);
  });
});

describe('labels and links', () => {
  it('lower-cases and trims the problem number in labels', () => {
    expect(buildPrbLabel(' PRB0099 ')).toBe('prb-prb0099');
    expect(buildPrbRoleLabel('PRB0099', 'qe')).toBe('prb-prb0099-qe');
  });

  it('reads the role back from a role label', () => {
    expect(readRoleFromLabels(['x', 'prb-prb0099-sl'], 'PRB0099')).toBe('sl');
    expect(readRoleFromLabels(['prb-prb0099'], 'PRB0099')).toBeNull();
  });

  it('links to the problem record on the ServiceNow instance', () => {
    expect(buildPrbRecordLink('https://snow.example.com/', 'PRB0012345'))
      .toBe('https://snow.example.com/problem.do?sysparm_query=number%3DPRB0012345');
  });
});
