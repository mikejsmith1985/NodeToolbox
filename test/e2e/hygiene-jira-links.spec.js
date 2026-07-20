// hygiene-jira-links.spec.js — E2E for GH #200 US1 + US2:
//   H1 — the "Missing Fix Version" check counts Stories/Tasks/Defects (not just Features), so a scope
//        with mixed-type issues lacking a fix version reports N, not 0.
//   H2 — each tile's "open in Jira ↗" link carries the family's SEMANTIC JQL (scope AND condition),
//        so a user can validate the count against Jira.
//   H3 — clicking the tile still applies the in-app finding filter (unchanged behavior).
//
// Jira is stubbed, so no live instance is needed.

'use strict';

const { test, expect } = require('@playwright/test');

// Three delivery issues of different types, all missing a fix version — pre-fix these would count 0.
function issueMissingFixVersion(issueKey, issueTypeName) {
  return {
    key: issueKey,
    fields: {
      summary: `${issueTypeName} without a fix version`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Alex Dev' },
      issuetype: { name: issueTypeName },
      created: '2026-06-01T00:00:00.000Z',
      updated: '2026-06-10T00:00:00.000Z',
      description: 'Given a team runs hygiene, when data loads, then flags appear.',
      customfield_10028: 3,
      fixVersions: [],
    },
  };
}

const SEEDED_ISSUES = [
  issueMissingFixVersion('ENCUC-1', 'Story'),
  issueMissingFixVersion('ENCUC-2', 'Task'),
  issueMissingFixVersion('ENCUC-3', 'Defect'),
];

async function stubHygieneJira(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/rest/api/2/field')) return json([]);
    if (url.includes('/search')) return json({ issues: SEEDED_ISSUES });
    if (url.includes('/transitions')) return json({ transitions: [] });
    if (url.includes('/editmeta')) return json({ fields: {} });
    return json({});
  });
}

// Locates the summary tile whose label matches, scoped away from the "N issues" score tile.
function fixVersionTile(page) {
  return page.locator('[class*="summaryTile"]').filter({ hasText: 'Missing Fix Version' }).first();
}

test.describe('GH #200 — hygiene fix-version fidelity + Jira links', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tbxHygieneProjectKey', 'ENCUC'));
    await stubHygieneJira(page);
  });

  test('H1: missing-fix-version counts Story/Task/Defect (not 0)', async ({ page }) => {
    await page.goto('/my-issues?tab=hygiene');

    const tile = fixVersionTile(page);
    await expect(tile).toBeVisible({ timeout: 10_000 });
    // All three seeded delivery issues lack a fix version → the tile counts them (pre-fix this was 0).
    await expect(tile.locator('strong')).toHaveText('3');
  });

  test('H2: the tile opens the family\'s semantic JQL in Jira (scope AND condition)', async ({ page }) => {
    await page.goto('/my-issues?tab=hygiene');
    const tile = fixVersionTile(page);
    await expect(tile).toBeVisible({ timeout: 10_000 });

    const openLink = tile.getByRole('link', { name: /Open Missing Fix Version in Jira/i });
    const href = await openLink.getAttribute('href');
    // The link is the semantic query — the family condition AND the scan's scope — not a key list.
    // JQL uses the singular `fixVersion` field alias (GH #200 follow-up).
    expect(decodeURIComponent(href)).toContain('fixVersion is EMPTY');
    expect(decodeURIComponent(href)).not.toContain('fixVersions');
    expect(decodeURIComponent(href)).toContain('issuetype in');
    expect(decodeURIComponent(href)).toContain('project=ENCUC');
    expect(openLink).toHaveAttribute('target', '_blank');
  });

  test('H3: clicking the tile still applies the in-app filter', async ({ page }) => {
    await page.goto('/my-issues?tab=hygiene');
    const tile = fixVersionTile(page);
    await expect(tile).toBeVisible({ timeout: 10_000 });

    await tile.click();
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
  });
});
