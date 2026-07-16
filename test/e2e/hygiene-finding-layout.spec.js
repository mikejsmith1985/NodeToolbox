// test/e2e/hygiene-finding-layout.spec.js — The Hygiene finding row's fix controls must stay inside
// their own column: at 12rem the inline editors (max-width 14rem) overflowed the track and painted
// over the Type meta card (GH #167 report).

'use strict';

const { test, expect } = require('@playwright/test');

const OLD_UPDATED = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

function staleIssue(key) {
  return {
    key,
    fields: {
      summary: `Stale thing ${key}`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Jordan, John' },
      issuetype: { name: 'Story' },
      created: OLD_UPDATED,
      updated: OLD_UPDATED,
      description: 'Context.',
      customfield_10028: 3,
      customfield_10301: 'PI 26.3 (05/21/26 - 07/29/26)',
      duedate: '2026-09-01',
      fixVersions: [{ name: 'R1' }],
    },
  };
}

test('hygiene finding row: fix controls never overlap the meta cards', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 950 });
  await page.addInitScript(() => {
    window.localStorage.setItem('tbxHygieneProjectKey', 'ENCUC');
  });
  await page.route('**/jira-proxy/**', (route) => {
    const url = route.request().url();
    if (url.includes('/rest/api/2/field')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
    if (url.includes('/search')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ issues: [staleIssue('ENCUC-1'), staleIssue('ENCUC-2')] }),
      });
    }
    if (url.includes('/transitions')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transitions: [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.goto('/my-issues?tab=hygiene');
  await expect(page.locator('[class*="findingRow"]').first()).toBeVisible({ timeout: 10_000 });

  const firstRow = page.locator('[class*="findingRow"]').first();
  const fixSelect = firstRow.locator('select[class*="fixSelect"]').first();
  const firstMetaCard = firstRow.locator('dl[class*="issueMeta"] > div').first();
  await expect(fixSelect).toBeVisible();
  await expect(firstMetaCard).toBeVisible();

  const selectRect = await fixSelect.evaluate((el) => el.getBoundingClientRect().right);
  const chipRect = await firstRow.locator('[class*="flagChip"]').first().evaluate((el) => el.getBoundingClientRect().right);
  const metaLeft = await firstMetaCard.evaluate((el) => el.getBoundingClientRect().left);

  // Every element of the fix column ends before the meta column begins — no overpainting.
  expect(selectRect).toBeLessThanOrEqual(metaLeft + 1);
  expect(chipRect).toBeLessThanOrEqual(metaLeft + 1);

  await firstRow.screenshot({ path: 'C:/Users/mikej/AppData/Local/Temp/claude/C--ProjectsWin-NodeToolbox/fb0e7472-5632-4b02-9c65-013b65e2f88f/scratchpad/hygiene-row-layout.png' });
});
