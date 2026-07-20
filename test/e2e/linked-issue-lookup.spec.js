// linked-issue-lookup.spec.js — E2E for GH #200 US3:
//   L1 — clicking a linked-issue key in the detail panel opens the F2 Quick Issue Lookup on that issue.
//   L2 — F2 itself still behaves exactly as feature 022 (regression guard).
//
// Reuses the feature 022 F2 lookup harness; Jira is stubbed.

'use strict';

const { test, expect } = require('@playwright/test');

const LOOKUP_DIALOG_NAME = 'Quick issue lookup';
const HOME_HEADING = 'Your personal utility belt';

function baseFields(issueKey, extra = {}) {
  return {
    summary: `Summary for ${issueKey}`,
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: { name: 'High', iconUrl: '' },
    assignee: { displayName: 'Jordan, John', accountId: 'acc-1' },
    issuetype: { name: 'Story', iconUrl: '' },
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    description: 'A described issue.',
    ...extra,
  };
}

// ENCUC-1234 links to ENCUC-42; both are fetchable so the click can load the linked one.
function issueForKey(issueKey) {
  if (issueKey === 'ENCUC-1234') {
    return {
      id: issueKey,
      key: issueKey,
      fields: baseFields(issueKey, {
        issuelinks: [
          {
            type: { name: 'Blocks', outward: 'blocks' },
            outwardIssue: {
              key: 'ENCUC-42',
              fields: { status: { name: 'Done', statusCategory: { key: 'done' } }, summary: 'The linked blocker' },
            },
          },
        ],
      }),
    };
  }
  return { id: issueKey, key: issueKey, fields: baseFields(issueKey) };
}

async function stubJira(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/editmeta')) return json({ fields: {} });
    if (url.includes('/transitions')) return json({ transitions: [] });
    if (url.includes('/comment')) return json({ comments: [], total: 0 });
    const issueMatch = url.match(/\/rest\/api\/2\/issue\/([^/?]+)\?/i);
    if (issueMatch) return json(issueForKey(decodeURIComponent(issueMatch[1]).toUpperCase()));
    return json({});
  });
}

test.describe('GH #200 — linked issue opens in the F2 lookup', () => {
  test.beforeEach(async ({ page }) => {
    await stubJira(page);
  });

  test('L1: clicking a linked-issue key opens the lookup on that issue', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
    await page.keyboard.press('F2');
    const dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    // The linked issue is shown; clicking its key swaps the lookup to it.
    await expect(dialog.getByText('Linked Issues')).toBeVisible();
    await dialog.getByRole('button', { name: /ENCUC-42/ }).click();
    await expect(dialog.getByText('Summary for ENCUC-42').first()).toBeVisible();
  });

  test('L2: F2 still opens the lookup focused (feature 022 regression)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
    await page.keyboard.press('F2');
    const dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Issue key')).toBeFocused();
  });
});
