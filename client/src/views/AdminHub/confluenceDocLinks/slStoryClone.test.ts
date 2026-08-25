// slStoryClone.test.ts — The team's own convention for making an SL story, kept identical every time.

import { describe, expect, it } from 'vitest';

import { buildSlContainmentLink, buildSlStoryPayload, buildSlStorySummary } from './slStoryClone.ts';

describe('buildSlStorySummary', () => {
  it('swaps the tag and changes NOTHING else', () => {
    // Keeping the rest byte-identical is what makes the pair recognisable — to a person scanning a
    // board, and to classifyChainRole, which reads the tag and nothing else.
    expect(buildSlStorySummary('[DEV] COB/MSP ingestion Subscribers with Multiple Groups'))
      .toBe('[SL] COB/MSP ingestion Subscribers with Multiple Groups');
  });

  it('swaps a lower-case or mixed-case tag too', () => {
    expect(buildSlStorySummary('[dev] Pass blank into keyword records'))
      .toBe('[SL] Pass blank into keyword records');
    expect(buildSlStorySummary('[Dev] Pass blank into keyword records'))
      .toBe('[SL] Pass blank into keyword records');
  });

  it('swaps a tag that is not at the start', () => {
    expect(buildSlStorySummary('INC0200382 [DEV] Load Status Report'))
      .toBe('INC0200382 [SL] Load Status Report');
  });

  it('prepends the tag when the dev story never had one', () => {
    // An untagged story is classified by its assignee, which is a guess — and this is a story whose
    // whole purpose is to be the test one.
    expect(buildSlStorySummary('Pass blank into keyword records'))
      .toBe('[SL] Pass blank into keyword records');
  });

  it('swaps only the FIRST tag, so a summary mentioning dev twice is not mangled', () => {
    expect(buildSlStorySummary('[DEV] dev work for the [DEV] pipeline'))
      .toBe('[SL] dev work for the [DEV] pipeline');
  });

  it('trims without inventing content for an empty summary', () => {
    expect(buildSlStorySummary('   ')).toBe('[SL]');
  });
});

describe('buildSlStoryPayload', () => {
  it('creates in the SAME project and type as the story it came from', () => {
    // A test story filed elsewhere would drop off the board that has to show it.
    const payload = buildSlStoryPayload({
      summary: '[DEV] COB/MSP ingestion',
      projectKey: 'ENCUC',
      issueTypeId: '10001',
    });

    expect(payload.fields.project).toEqual({ key: 'ENCUC' });
    expect(payload.fields.issuetype).toEqual({ id: '10001' });
    expect(payload.fields.summary).toBe('[SL] COB/MSP ingestion');
  });

  it('carries inherited fields through without naming any of them here', () => {
    // Which fields matter is an instance question; this module must not become a second place where
    // field ids live.
    const payload = buildSlStoryPayload({
      summary: '[DEV] x',
      projectKey: 'ENCUC',
      issueTypeId: '10001',
      // A deliberately anonymous key: the point is that ANY field passes through untouched, and
      // naming a real custom field id here would put one in a second place, which is the thing the
      // field-mapping ratchet exists to stop.
      inheritedFields: { fixVersions: [{ name: '09/10/2026' }], theFeatureLinkField: 'DENP-475' },
    });

    expect(payload.fields.fixVersions).toEqual([{ name: '09/10/2026' }]);
    expect(payload.fields.theFeatureLinkField).toBe('DENP-475');
  });

  it('never lets an inherited field override the three it owns', () => {
    const payload = buildSlStoryPayload({
      summary: '[DEV] x',
      projectKey: 'ENCUC',
      issueTypeId: '10001',
      inheritedFields: { summary: 'the old summary', project: { key: 'WRONG' } },
    });

    expect(payload.fields.summary).toBe('[SL] x');
    expect(payload.fields.project).toEqual({ key: 'ENCUC' });
  });
});

describe('buildSlContainmentLink', () => {
  it('puts the SL story INSIDE the dev story, which is the direction the board reads', () => {
    // Backwards, the board shows the dev story nested inside its own test story — wrong in a way
    // nobody reports as a bug.
    const link = buildSlContainmentLink('ENCUC-2358', 'ENCUC-2213', 'Container');

    expect(link).toEqual({
      innerIssueKey: 'ENCUC-2358',
      outerIssueKey: 'ENCUC-2213',
      linkTypeName: 'Container',
    });
  });
});
