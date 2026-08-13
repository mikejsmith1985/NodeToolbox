// test/unit/containmentLinkRepair.test.js — Proves the repair only ever touches links it can PROVE are
// backwards, and that the corrected payload is the shape Jira actually needs.
//
// The bug being repaired: until v0.168.4 the app named each end of a new link by the phrase it wanted
// displayed, when Jira reads those fields as roles. The result was links saying "the Dev story is
// contained within the SL story" — the reverse of the team's intent.

'use strict';

const {
  buildRepairedLinkPayload,
  classifyContainmentLinks,
  describeRepair,
  readContainmentLinks,
  readPromotedFromParentKey,
  summarizeClassifications,
} = require('../../src/services/containmentLinkRepair');

const CONTAINER_TYPE = { name: 'Container', inward: 'is contained within', outward: 'contains' };

/** An issue holding one containment link, seen from its own side. */
function makeIssue(key, { description = '', link = null } = {}) {
  return {
    key,
    fields: {
      summary: key,
      description,
      issuelinks: link ? [link] : [],
    },
  };
}

/** The link entry Jira returns to the issue that reads "contained within". */
function containedEntry(linkId, containerKey, type = CONTAINER_TYPE) {
  return { id: linkId, type, inwardIssue: { key: containerKey } };
}

/** The link entry Jira returns to the issue that reads "contains". */
function containerEntry(linkId, containedKey, type = CONTAINER_TYPE) {
  return { id: linkId, type, outwardIssue: { key: containedKey } };
}

describe('readPromotedFromParentKey', () => {
  it('reads the parent a promoted Story came from', () => {
    const issue = makeIssue('ENCUC-2311', {
      description: 'Promoted from sub-task ENCUC-2209 of ENCUC-2208, status "To Do".',
    });

    expect(readPromotedFromParentKey(issue)).toBe('ENCUC-2208');
  });

  it('reads nothing from an issue the promotion tool did not create', () => {
    expect(readPromotedFromParentKey(makeIssue('ENCUC-1', { description: 'A normal story.' }))).toBeNull();
    expect(readPromotedFromParentKey(makeIssue('ENCUC-1'))).toBeNull();
  });
});

describe('readContainmentLinks', () => {
  it('knows which end is contained when this issue reads "contained within"', () => {
    const [link] = readContainmentLinks(makeIssue('ENCUC-2311', { link: containedEntry('1', 'ENCUC-2208') }));

    expect(link.containedKey).toBe('ENCUC-2311');
    expect(link.containerKey).toBe('ENCUC-2208');
  });

  it('knows which end is contained when this issue reads "contains"', () => {
    const [link] = readContainmentLinks(makeIssue('ENCUC-2208', { link: containerEntry('1', 'ENCUC-2311') }));

    expect(link.containedKey).toBe('ENCUC-2311');
    expect(link.containerKey).toBe('ENCUC-2208');
  });

  it('reads a link type worded the other way round', () => {
    const invertedType = { name: 'Containment', inward: 'contains', outward: 'is contained within' };
    const [link] = readContainmentLinks(
      makeIssue('ENCUC-2311', { link: { id: '1', type: invertedType, outwardIssue: { key: 'ENCUC-2208' } } }),
    );

    expect(link.containedKey).toBe('ENCUC-2311');
  });

  it('ignores links that are not containment', () => {
    const blocks = { id: '9', type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'X-1' } };

    expect(readContainmentLinks(makeIssue('ENCUC-1', { link: blocks }))).toEqual([]);
  });
});

describe('classifyContainmentLinks', () => {
  it('proves a link is backwards from the promoted Story\'s own description', () => {
    // The production case: ENCUC-2311 was promoted out of ENCUC-2208, so it belongs INSIDE 2208 —
    // and the link says 2208 is inside 2311.
    const promotedStory = makeIssue('ENCUC-2311', {
      description: 'Promoted from sub-task ENCUC-2209 of ENCUC-2208, status "To Do".',
      link: containerEntry('101', 'ENCUC-2208'),
    });
    const devStory = makeIssue('ENCUC-2208', { link: containedEntry('101', 'ENCUC-2311') });

    const [classification] = classifyContainmentLinks([promotedStory, devStory]);

    expect(classification.kind).toBe('backwards');
    expect(classification.shouldBeContainedKey).toBe('ENCUC-2311');
    expect(classification.shouldBeContainerKey).toBe('ENCUC-2208');
  });

  it('leaves a link that already matches the evidence alone', () => {
    const promotedStory = makeIssue('ENCUC-2311', {
      description: 'Promoted from sub-task ENCUC-2209 of ENCUC-2208, status "To Do".',
      link: containedEntry('101', 'ENCUC-2208'),
    });

    expect(classifyContainmentLinks([promotedStory])[0].kind).toBe('correct');
  });

  it('never repairs a link it cannot prove, however tempting', () => {
    // Somebody may have linked these by hand and meant exactly what they wrote.
    const handMade = makeIssue('ENCUC-1', { link: containerEntry('102', 'ENCUC-2') });

    const [classification] = classifyContainmentLinks([handMade]);

    expect(classification.kind).toBe('unverifiable');
    expect(classification.reason).toMatch(/not recorded/);
  });

  it('judges each link once even though it is visible from both ends', () => {
    const promotedStory = makeIssue('ENCUC-2311', {
      description: 'Promoted from sub-task ENCUC-2209 of ENCUC-2208.',
      link: containerEntry('101', 'ENCUC-2208'),
    });
    const devStory = makeIssue('ENCUC-2208', { link: containedEntry('101', 'ENCUC-2311') });

    // Offering the same repair twice would delete the link and then fail to find it.
    expect(classifyContainmentLinks([promotedStory, devStory])).toHaveLength(1);
  });

  it('finds the evidence whichever end of the pair carries it', () => {
    const devStory = makeIssue('ENCUC-2208', { link: containedEntry('101', 'ENCUC-2311') });
    const promotedStory = makeIssue('ENCUC-2311', {
      description: 'Promoted from sub-task ENCUC-2209 of ENCUC-2208.',
      link: containerEntry('101', 'ENCUC-2208'),
    });

    // Same pair, opposite order in the result set.
    expect(classifyContainmentLinks([devStory, promotedStory])[0].kind).toBe('backwards');
  });
});

describe('buildRepairedLinkPayload', () => {
  it('puts the contained issue where the "contained within" phrase lives', () => {
    const [link] = readContainmentLinks(makeIssue('ENCUC-2208', { link: containerEntry('101', 'ENCUC-2311') }));

    // Conventional wording: "contained within" is the INWARD phrase, and an issue reads with the
    // inward phrase when it is the request's outwardIssue.
    expect(buildRepairedLinkPayload(link, 'ENCUC-2311', 'ENCUC-2208')).toEqual({
      type: { name: 'Container' },
      inwardIssue: { key: 'ENCUC-2208' },
      outwardIssue: { key: 'ENCUC-2311' },
    });
  });

  it('swaps the sides for an instance that words the pair the other way round', () => {
    const invertedType = { name: 'Containment', inward: 'contains', outward: 'is contained within' };
    const [link] = readContainmentLinks(
      makeIssue('ENCUC-2208', { link: { id: '1', type: invertedType, inwardIssue: { key: 'ENCUC-2311' } } }),
    );

    const payload = buildRepairedLinkPayload(link, 'ENCUC-2311', 'ENCUC-2208');
    expect(payload.inwardIssue.key).toBe('ENCUC-2311');
    expect(payload.outwardIssue.key).toBe('ENCUC-2208');
  });
});

describe('reporting', () => {
  it('describes a repair in terms of what is wrong and why we know', () => {
    const promotedStory = makeIssue('ENCUC-2311', {
      description: 'Promoted from sub-task ENCUC-2209 of ENCUC-2208.',
      link: containerEntry('101', 'ENCUC-2208'),
    });

    const sentence = describeRepair(classifyContainmentLinks([promotedStory])[0]);
    expect(sentence).toContain('ENCUC-2311');
    expect(sentence).toContain('promoted from a sub-task');
  });

  it('counts every outcome, so nothing is quietly skipped', () => {
    const summary = summarizeClassifications([
      { kind: 'backwards' }, { kind: 'correct' }, { kind: 'unverifiable' }, { kind: 'unverifiable' },
    ]);

    expect(summary).toBe('1 backwards, 1 already correct, 2 unverifiable (left alone).');
  });
});
