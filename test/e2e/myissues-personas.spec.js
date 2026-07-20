// myissues-personas.spec.js — E2E for GH #200 US6: My Issues can be viewed as another Jira user (M1)
// and through a role lens with SM/PO team views (M2). Read-only; Jira is stubbed.

'use strict';

const { test, expect } = require('@playwright/test');

const ROSTER = {
  rosterMembers: [
    { displayName: 'Alex Dev', assigneeQueryValue: 'alex', jiraAccountId: 'alex-1', teamName: 'Team Rocket', roleCapabilities: { canDevelop: true } },
  ],
};

async function seedRoster(page) {
  await page.addInitScript((roster) => {
    window.localStorage.setItem('tbxSprintDashboardRoster:legacy-default', JSON.stringify(roster));
  }, ROSTER);
}

async function stubMyIssuesJira(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/user/search')) {
      return json([{ accountId: 'abc-123', displayName: 'Jordan Watkins' }]);
    }
    if (url.includes('/search')) return json({ issues: [] });
    return json({});
  });
}

test.describe('GH #200 — My Issues personas', () => {
  test.beforeEach(async ({ page }) => {
    await seedRoster(page);
    await stubMyIssuesJira(page);
  });

  test('M1: simulate as another user shows a banner, and Back to me restores', async ({ page }) => {
    await page.goto('/my-issues?tab=report');

    const simulateInput = page.getByLabel('Simulate as user');
    await expect(simulateInput).toBeVisible({ timeout: 10_000 });
    await simulateInput.fill('jordan');
    await page.getByRole('button', { name: 'Simulate', exact: true }).click();

    // Pick the searched user → the report is now "as" them, with a banner.
    await page.getByRole('button', { name: /Jordan Watkins/ }).click();
    const banner = page.getByRole('status').filter({ hasText: /Viewing as Jordan Watkins/ });
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Back to me' }).click();
    await expect(page.getByText(/Viewing as Jordan Watkins/)).toHaveCount(0);
  });

  test('M2: the role lens switches, and SM/PO lenses reveal a team view', async ({ page }) => {
    await page.goto('/my-issues?tab=report');

    const roleLens = page.getByLabel('Role lens');
    await expect(roleLens).toBeVisible({ timeout: 10_000 });

    // The team-view select appears only for the coordinating (SM/PO) lenses (FR-022).
    await expect(page.getByLabel('Team view')).toHaveCount(0);
    await roleLens.selectOption('sm');
    const teamView = page.getByLabel('Team view');
    await expect(teamView).toBeVisible();
    // At minimum it offers the "My work" option; roster-team options populate when a team roster is loaded.
    await expect(teamView.locator('option', { hasText: 'My work' })).toHaveCount(1);
  });
});
