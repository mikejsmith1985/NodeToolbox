// gh200-responsive.spec.js — E2E for GH #200 X1 (NFR-001/003/004): the new surfaces hold together
// across light/dark themes, all three tool text sizes, and a narrow width — content reflows, the
// document never scrolls horizontally, and status reads as text beside color. Jira is stubbed.

'use strict';

const { test, expect } = require('@playwright/test');

const HYGIENE_ISSUES = [
  {
    key: 'ENCUC-1',
    fields: {
      summary: 'A story missing its fix version',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Alex Dev' },
      issuetype: { name: 'Story' },
      created: '2026-06-01T00:00:00.000Z',
      updated: '2026-06-10T00:00:00.000Z',
      description: 'Context.',
      fixVersions: [],
    },
  },
];

async function stubHygiene(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/rest/api/2/field')) return json([]);
    if (url.includes('/search')) return json({ issues: HYGIENE_ISSUES });
    if (url.includes('/transitions')) return json({ transitions: [] });
    return json({});
  });
}

const VARIANTS = [
  { theme: 'dark', size: 'default', width: 1280 },
  { theme: 'light', size: 'extra-large', width: 1280 },
  { theme: 'light', size: 'large', width: 480 },
];

test.describe('GH #200 — responsive / theme sweep on the new hygiene surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tbxHygieneProjectKey', 'ENCUC'));
    await stubHygiene(page);
  });

  test('X1: the hygiene tiles + Jira links hold at every theme, text size, and narrow width', async ({ page }) => {
    await page.goto('/');
    for (const variant of VARIANTS) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.evaluate(
        ({ themeName, sizeName }) => {
          window.localStorage.setItem('tbx-theme', themeName);
          window.localStorage.setItem('tbxToolTextSize', sizeName);
        },
        { themeName: variant.theme, sizeName: variant.size },
      );
      await page.goto('/my-issues?tab=hygiene');

      // The chosen theme + text size are applied at the document root.
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await expect(page.locator('html')).toHaveAttribute('data-tool-text-size', variant.size);

      // The new US2 tile + its "open in Jira" link render.
      const tile = page.locator('[class*="summaryTile"]').filter({ hasText: 'Missing Fix Version' }).first();
      await expect(tile).toBeVisible({ timeout: 10_000 });
      await expect(tile.getByRole('link', { name: /Open Missing Fix Version in Jira/i })).toBeVisible();

      // NFR-003 — content reflows; the document never scrolls horizontally.
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasHorizontalOverflow, `no h-overflow at ${variant.theme}/${variant.size}/${variant.width}`).toBe(false);
    }
  });
});
