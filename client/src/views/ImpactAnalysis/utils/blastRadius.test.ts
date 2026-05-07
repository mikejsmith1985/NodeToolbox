// blastRadius.test.ts — Unit coverage for pure Impact Analysis blast-radius helpers.

import { describe, expect, it } from 'vitest';

import {
  computeBlastStats,
  mapJiraIssueToRelatedIssue,
  normalizeLinkType,
  parseIssueLinks,
  type BlastChild,
  type BlastLink,
  type JiraIssueLink,
} from './blastRadius.ts';

function buildLinkedIssue(issueKey: string, statusCategoryKey = 'indeterminate') {
  return {
    key: issueKey,
    fields: {
      summary: `${issueKey} summary`,
      status: { name: statusCategoryKey === 'done' ? 'Done' : 'In Progress', statusCategory: { key: statusCategoryKey } },
    },
  };
}

function buildBlastLink(issueKey: string, statusCategoryKey: 'new' | 'indeterminate' | 'done', linkType = 'relates to'): BlastLink {
  return {
    direction: 'outward',
    linkType,
    related: {
      key: issueKey,
      summary: `${issueKey} summary`,
      statusName: statusCategoryKey === 'done' ? 'Done' : 'In Progress',
      statusCategoryKey,
    },
    isBlocker: linkType.includes('block'),
  };
}

describe('normalizeLinkType', () => {
  it('lowercases and trims Jira link labels', () => {
    expect(normalizeLinkType('  Blocks  ')).toBe('blocks');
  });

  it('uses relates to when Jira omits a link label', () => {
    expect(normalizeLinkType(undefined)).toBe('relates to');
  });
});

describe('parseIssueLinks', () => {
  it('returns separate outward and inward arrays from Jira links', () => {
    const issueLinks: JiraIssueLink[] = [
      {
        type: { outward: 'blocks', inward: 'is blocked by', name: 'Blocks' },
        outwardIssue: buildLinkedIssue('TBX-2'),
        inwardIssue: buildLinkedIssue('TBX-3', 'done'),
      },
    ];

    const parsedLinks = parseIssueLinks(issueLinks);

    expect(parsedLinks.outward).toMatchObject([{ direction: 'outward', linkType: 'blocks', related: { key: 'TBX-2' }, isBlocker: true }]);
    expect(parsedLinks.inward).toMatchObject([{ direction: 'inward', linkType: 'is blocked by', related: { key: 'TBX-3' }, isBlocker: true }]);
  });

  it('falls back to type.name when directional labels are missing', () => {
    const parsedLinks = parseIssueLinks([{ type: { name: 'Relates' }, outwardIssue: buildLinkedIssue('TBX-4') }]);

    expect(parsedLinks.outward[0].linkType).toBe('relates');
  });

  it('handles missing issue links gracefully', () => {
    expect(parseIssueLinks(undefined)).toEqual({ inward: [], outward: [] });
  });

  it('skips link directions when Jira omits the related issue object', () => {
    const parsedLinks = parseIssueLinks([{ type: { name: 'Blocks' }, outwardIssue: buildLinkedIssue('TBX-5') }]);

    expect(parsedLinks.outward).toHaveLength(1);
    expect(parsedLinks.inward).toEqual([]);
  });
});

describe('computeBlastStats', () => {
  it('counts related links, children, blockers, open items, and done items', () => {
    const inwardLinks = [buildBlastLink('TBX-10', 'done', 'is blocked by')];
    const outwardLinks = [buildBlastLink('TBX-11', 'indeterminate', 'blocks'), buildBlastLink('TBX-12', 'new')];
    const children: BlastChild[] = [
      { key: 'TBX-13', summary: 'Child done', statusName: 'Done', statusCategoryKey: 'done' },
      { key: 'TBX-14', summary: 'Child open', statusName: 'To Do', statusCategoryKey: 'new' },
    ];

    expect(computeBlastStats(inwardLinks, outwardLinks, children)).toEqual({
      totalRelated: 5,
      blockerCount: 2,
      openCount: 3,
      doneCount: 2,
    });
  });

  it('returns zero counts when there are no related issues', () => {
    expect(computeBlastStats([], [], [])).toEqual({ totalRelated: 0, blockerCount: 0, openCount: 0, doneCount: 0 });
  });
});

describe('mapJiraIssueToRelatedIssue', () => {
  it('uses sensible defaults when Jira omits nested fields', () => {
    expect(mapJiraIssueToRelatedIssue({})).toEqual({
      key: 'UNKNOWN',
      summary: 'Untitled Jira issue',
      statusName: 'Unknown',
      statusCategoryKey: 'unknown',
    });
  });

  it('normalizes unknown status categories to unknown', () => {
    expect(mapJiraIssueToRelatedIssue(buildLinkedIssue('TBX-20', 'archived')).statusCategoryKey).toBe('unknown');
  });
});
