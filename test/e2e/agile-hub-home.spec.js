// agile-hub-home.spec.js — E2E gates for spec 020: honest SNow gating, live visibility toggles,
// and the Agile Hub redirect journeys (params intact), plus the A++/narrow layout hold.

'use strict';

const { test, expect } = require('@playwright/test');

async function stubProxies(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const requestUrl = decodeURIComponent(route.request().url());
    if (requestUrl.includes('/rest/api/2/field')) return route.fulfill({ json: [] });
    return route.fulfill({ json: { issues: [], transitions: [], comments: [], values: [] } });
  });
  await page.route('**/confluence-proxy/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/snow-proxy/**', (route) => route.fulfill({ json: {} }));
}

// The admin unlock is session-scoped; seeding the flag is the suite's established pattern.
async function seedAdminUnlock(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('tbxAdminUnlocked', '1');
  });
}

// A configured team: without one the dashboard (correctly) forces its Settings/setup tab, so the
// persisted-tab behaviors under test only apply once setup is complete (existing product rule).
async function seedConfiguredTeam(page) {
  await page.addInitScript(() => {
    const teamProfileId = 'e2e-team-1';
    window.localStorage.setItem('tbxSprintDashboardTeams', JSON.stringify([{
      id: teamProfileId, name: 'E2E Team', projectKey: 'ENCUC', boardId: '42', boardName: 'E2E Board',
      boardType: 'scrum', scopeMode: 'sprint', selectedSprintId: '', selectedFixVersion: '',
      selectedPiValue: '', piReviewPages: [],
    }]));
    window.localStorage.setItem('tbxSprintDashboardActiveTeamProfileId', teamProfileId);
    window.localStorage.setItem('tbxSprintDashboardProjectKey', 'ENCUC');
    window.localStorage.setItem('tbxSprintDashboardBoardId', '42');
  });
}

test.describe('spec 020 — honest gating and the Agile Hub', () => {
  test.beforeEach(async ({ page }) => {
    await stubProxies(page);
  });

  test('locked: no SNow card on home and direct /snow-hub lands home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your personal utility belt' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SNow Hub' })).not.toBeVisible();

    await page.goto('/snow-hub');
    await expect(page.getByRole('heading', { name: 'Your personal utility belt' })).toBeVisible();
  });

  test('unlocked: the SNow card appears and /snow-hub admits', async ({ page }) => {
    await seedAdminUnlock(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'SNow Hub' })).toBeVisible();

    await page.goto('/snow-hub');
    await expect(page).toHaveURL(/\/snow-hub/);
  });

  test('an Admin Hub visibility toggle hides the card on home without a reload', async ({ page }) => {
    await seedAdminUnlock(page);
    await page.goto('/admin-hub');

    // Tool Visibility lives on the dev-panel admin tab.
    await page.getByTestId('admin-hub-dev-panel-tab').click();
    const textToolsToggle = page.getByLabel('Toggle visibility of Text Tools');
    await textToolsToggle.scrollIntoViewIfNeeded();
    await textToolsToggle.uncheck();

    // SPA navigation (no reload) — the home page reads the same store.
    await page.getByRole('link', { name: 'NodeToolbox' }).click();
    await expect(page.getByRole('heading', { name: 'Your personal utility belt' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Text Tools', exact: true })).not.toBeVisible();
  });

  test('FR-010 acceptance: /sprint-dashboard?hygieneFilter=stale lands in the Team space, filter intact', async ({ page }) => {
    await seedConfiguredTeam(page);
    await page.goto('/sprint-dashboard?hygieneFilter=stale');

    // The redirect preserved the query and appended the space — mid-flight, not a lobby.
    await expect(page).toHaveURL(/\/agile-hub\?hygieneFilter=stale&space=team/);
    await expect(page.getByRole('button', { name: '🏃 Team' })).toHaveAttribute('aria-pressed', 'true');

    // Opening the hygiene tab inside the space consumes the surviving filter param.
    await page.getByTestId('team-dashboard-hygiene-tab').click();
    await expect(page.getByRole('button', { name: /^\d+ Stale/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('FR-012: each space keeps its own working context across a switch round-trip', async ({ page }) => {
    await seedConfiguredTeam(page);
    await page.goto('/agile-hub?space=team');

    // Put the Team space on a non-default tab, exactly as a user would.
    await page.getByTestId('team-dashboard-hygiene-tab').click();
    await expect(page.getByTestId('team-dashboard-hygiene-tab')).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: '🧭 Product' }).click();
    await expect(page).toHaveURL(/space=product/);

    await page.getByRole('button', { name: '🏃 Team' }).click();
    // The Team space returns exactly where it was: same tab, nothing reset.
    await expect(page.getByTestId('team-dashboard-hygiene-tab')).toHaveAttribute('aria-selected', 'true');
  });

  test('the space strip holds at A++ text size in a narrow window — no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/agile-hub');
    await page.getByRole('button', { name: 'Extra large text size' }).click();

    await expect(page.getByRole('button', { name: '🚂 Train' })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
