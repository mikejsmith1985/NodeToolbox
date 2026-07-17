// hygiene-session.spec.js — E2E gates for the guided hygiene cleanup session (spec 019 US3):
// arrow/skip/comment through seeded findings → an honest four-bucket summary; typing in the
// comment box never navigates or skips; the layout holds at A++ text size in a narrow window.

'use strict';

const { test, expect } = require('@playwright/test');

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(dayCount) {
  return new Date(Date.now() - dayCount * DAY_MS).toISOString();
}

function isoDaysAhead(dayCount) {
  return new Date(Date.now() + dayCount * DAY_MS).toISOString().slice(0, 10);
}

// Three issues whose ONLY hygiene flag is staleness — every other check is satisfied so the
// session walks exactly three findings.
function buildStaleIssue(issueKey) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary: `Stale work item ${issueKey}`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' },
      assignee: { displayName: 'Jordan, John' },
      created: isoDaysAgo(30),
      updated: isoDaysAgo(20),
      description: 'Steps:\nDay one:\nDo the thing',
      duedate: isoDaysAhead(30),
      fixVersions: [{ name: 'Release 26.4' }],
      labels: ['component'],
      parent: { key: 'ENCUC-1500' },
      customfield_10028: 3,
      customfield_10200: 'Given/When/Then',
      customfield_10301: 'PI 26.3',
      customfield_10108: 'ENCUC-1500',
      customfield_10101: isoDaysAhead(5),
      customfield_10102: isoDaysAhead(40),
      issuelinks: [],
    },
  };
}

const FIELD_METADATA = [
  { id: 'customfield_10200', name: 'Acceptance Criteria' },
  { id: 'customfield_10108', name: 'Feature Link' },
  { id: 'customfield_10301', name: 'Program Increment' },
  { id: 'customfield_10101', name: 'Target Start' },
  { id: 'customfield_10102', name: 'Target End' },
];

async function stubJiraProxies(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const requestUrl = decodeURIComponent(route.request().url());
    if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
      return route.fulfill({ json: {} });
    }
    if (requestUrl.includes('/rest/api/2/field')) {
      return route.fulfill({ json: FIELD_METADATA });
    }
    if (requestUrl.includes('/comment')) {
      return route.fulfill({ json: { comments: [] } });
    }
    if (requestUrl.includes('/transitions')) {
      return route.fulfill({ json: { transitions: [] } });
    }
    if (requestUrl.includes('/editmeta')) {
      return route.fulfill({ json: { fields: {} } });
    }
    if (requestUrl.includes('/rest/api/2/search')) {
      // The child-story rollup query has no matching Features here; the scan query gets 3 issues.
      const isRollupQuery = requestUrl.includes('parent in');
      return route.fulfill({
        json: { issues: isRollupQuery ? [] : ['ENCUC-1', 'ENCUC-2', 'ENCUC-3'].map(buildStaleIssue) },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/confluence-proxy/**', (route) => route.fulfill({ json: {} }));
}

async function runHygieneScan(page) {
  await page.goto('/my-issues?tab=hygiene');
  await page.getByLabel('Project key').fill('ENCUC');
  await page.getByRole('button', { name: 'Run Hygiene' }).click();
  await expect(page.getByRole('button', { name: /review these findings/i })).toBeVisible();
}

test.describe('hygiene cleanup session', () => {
  test.beforeEach(async ({ page }) => {
    await stubJiraProxies(page);
  });

  test('skip + comment + escape produce the honest four-bucket summary', async ({ page }) => {
    await runHygieneScan(page);

    await page.getByRole('button', { name: /review these findings/i }).click();
    await expect(page.getByText('Reviewing 1 of 3')).toBeVisible();

    // Keyboard skip settles the first finding and advances.
    await page.keyboard.press('s');
    await expect(page.getByText('Reviewing 2 of 3')).toBeVisible();
    await expect(page.getByText('⤼ skipped')).toBeVisible();

    // Typing an "s"-bearing comment must neither skip nor navigate (guard gate).
    const commentBox = page.getByLabel(/Add Comment/i);
    await commentBox.fill('still discussing with ESI folks');
    await expect(page.getByText('Reviewing 2 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Post Comment' }).click();
    await expect(page.getByText('💬 commented')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('3 findings — 0 fixed, 1 commented, 1 skipped, 1 untouched')).toBeVisible();
  });

  test('the session layout holds at A++ text size in a narrow window — no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await runHygieneScan(page);
    await page.getByRole('button', { name: 'Extra large text size' }).click();

    await page.getByRole('button', { name: /review these findings/i }).click();
    await expect(page.getByText('Reviewing 1 of 3')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
