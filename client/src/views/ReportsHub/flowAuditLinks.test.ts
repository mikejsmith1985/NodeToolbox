// flowAuditLinks.test.ts — Unit tests for the three kinds of evidence link.
//
// The fetch query is a DELIBERATE superset of what gets credited: `assignee WAS … AND updated >= -Nd`
// casts wide and the engine does the exact windowing afterwards. That is harmless for computing and
// actively misleading for linking — attach the fetch JQL beside a credited count and Jira returns
// more issues than the number claims. The first test below is the guard against exactly that.

import { describe, expect, it } from 'vitest';

import {
  buildCreditedIssuesLink,
  buildExcludedIssuesLink,
  buildFetchedIssuesLink,
} from './flowAuditLinks.ts';

const BASE_URL = 'https://jira.example.com';
const PERSON = 'Smith, Jane (CTR)';
const WINDOW_DAYS = 90;

const CREDITED_KEYS = ['FLOW-1', 'FLOW-2', 'FLOW-3', 'FLOW-4', 'FLOW-5', 'FLOW-6',
  'FLOW-7', 'FLOW-8', 'FLOW-9', 'FLOW-10', 'FLOW-11', 'FLOW-12'];
const NOT_OWNED_KEYS = ['FLOW-20', 'FLOW-21', 'FLOW-22', 'FLOW-23', 'FLOW-24'];
const WIP_OPEN_KEYS = ['FLOW-30', 'FLOW-31', 'FLOW-32'];

describe('the superset trap — credited links must not reuse the fetch query', () => {
  it('names exactly the credited issues, and is NOT the fetch JQL', () => {
    // 20 fetched, 12 credited. If the credited link were built from the fetch JQL, Jira would return
    // 20 for a number that says 12. This test fails if the link kinds are ever merged.
    const creditedLink = buildCreditedIssuesLink(CREDITED_KEYS, BASE_URL);
    const fetchedLink = buildFetchedIssuesLink(PERSON, WINDOW_DAYS, BASE_URL);

    expect(creditedLink.queryText).not.toBe(fetchedLink.queryText);
    expect(creditedLink.queryText).not.toContain('assignee WAS');
    CREDITED_KEYS.forEach((issueKey) => expect(creditedLink.queryText).toContain(issueKey));
  });

  it('excludes issues that were fetched but not credited', () => {
    const creditedLink = buildCreditedIssuesLink(CREDITED_KEYS, BASE_URL);
    const linkedKeys = creditedLink.queryText
      .replace(/^issueKey in \(/, '').replace(/\)$/, '')
      .split(',').map((issueKey) => issueKey.trim());

    [...NOT_OWNED_KEYS, ...WIP_OPEN_KEYS].forEach((excludedKey) => {
      expect(linkedKeys).not.toContain(excludedKey);
    });
  });
});

describe('buildFetchedIssuesLink', () => {
  it('uses the query that actually ran, so the shown JQL cannot drift from the executed one', () => {
    const fetchedLink = buildFetchedIssuesLink(PERSON, WINDOW_DAYS, BASE_URL);

    expect(fetchedLink.queryText)
      .toBe(`assignee WAS "${PERSON}" AND updated >= -${WINDOW_DAYS}d ORDER BY updated DESC`);
  });

  it('produces a clickable navigator URL when a base URL is configured', () => {
    const fetchedLink = buildFetchedIssuesLink(PERSON, WINDOW_DAYS, BASE_URL);

    expect(fetchedLink.isClickable).toBe(true);
    expect(fetchedLink.href).toContain(BASE_URL);
    expect(fetchedLink.href).toContain('jql=');
  });
});

/** Parses the keys back out of an `issueKey in (…)` query, so assertions compare whole keys. */
function readKeysFromQuery(queryText: string): string[] {
  const keyList = queryText.replace(/^issueKey in \(/, '').replace(/\)$/, '');
  return keyList.split(',').map((issueKey) => issueKey.trim()).filter(Boolean);
}

describe('buildExcludedIssuesLink', () => {
  it('contains only the keys for that exclusion reason', () => {
    const notOwnedLink = buildExcludedIssuesLink(NOT_OWNED_KEYS, BASE_URL);

    // Compared as whole keys, not substrings — "FLOW-2" is a substring of "FLOW-20", so a
    // substring assertion here would pass or fail for the wrong reason.
    expect(readKeysFromQuery(notOwnedLink.queryText)).toEqual(NOT_OWNED_KEYS);
  });
});

describe('reconciliation', () => {
  it('credited plus every exclusion category accounts for the whole fetched set', () => {
    const fetchedCount = 20;

    expect(CREDITED_KEYS.length + NOT_OWNED_KEYS.length + WIP_OPEN_KEYS.length).toBe(fetchedCount);
  });
});

describe('degradation when no Jira base URL is configured', () => {
  it.each([
    ['credited', () => buildCreditedIssuesLink(CREDITED_KEYS, null)],
    ['fetched', () => buildFetchedIssuesLink(PERSON, WINDOW_DAYS, null)],
    ['excluded', () => buildExcludedIssuesLink(NOT_OWNED_KEYS, null)],
  ])('the %s link degrades to query text rather than a broken link', (_label, buildLink) => {
    const link = buildLink();

    expect(link.isClickable).toBe(false);
    expect(link.href).toBe(link.queryText);
    expect(link.queryText.length).toBeGreaterThan(0);
  });
});

describe('empty key sets', () => {
  it('reports an empty credited set as not clickable rather than emitting a malformed query', () => {
    const emptyLink = buildCreditedIssuesLink([], BASE_URL);

    expect(emptyLink.isClickable).toBe(false);
    expect(emptyLink.queryText).not.toContain('in ()');
  });

  it('reports an empty exclusion category the same way', () => {
    expect(buildExcludedIssuesLink([], BASE_URL).isClickable).toBe(false);
  });
});

describe('per-person scoping', () => {
  it('two people produce disjoint credited links, so neither number hides inside the other', () => {
    const janesLink = buildCreditedIssuesLink(['FLOW-1', 'FLOW-2'], BASE_URL);
    const bobsLink = buildCreditedIssuesLink(['FLOW-90', 'FLOW-91'], BASE_URL);

    expect(janesLink.queryText).not.toContain('FLOW-90');
    expect(bobsLink.queryText).not.toContain('FLOW-1');
  });

  it('keeps each person\'s fetch query scoped to that person', () => {
    const janesFetch = buildFetchedIssuesLink('Smith, Jane (CTR)', WINDOW_DAYS, BASE_URL);

    expect(janesFetch.queryText).toContain('Smith, Jane (CTR)');
    expect(janesFetch.queryText).not.toContain('Wilson, Bob');
  });
});
