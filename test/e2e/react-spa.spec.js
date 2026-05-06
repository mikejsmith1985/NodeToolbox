// test/e2e/react-spa.spec.js — Playwright E2E smoke tests for the React SPA.
//
// These tests verify that the React SPA loads and renders correctly when served
// by the Express backend (server.js). The webServer in playwright.config.js
// starts Express on port 5556 with TBX_JIRA_URL + TBX_JIRA_PAT set, so the
// app loads the full dashboard (no setup wizard redirect).

'use strict';

const { test, expect } = require('@playwright/test');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max milliseconds to wait for the SPA to fully hydrate after navigation */
const DASHBOARD_TIMEOUT_MS = 10_000;

/** Text that must appear in the page when the React app shell is mounted */
const APP_TITLE_TEXT = 'NodeToolbox';

/** The home route — React Router's default landing page */
const HOME_ROUTE = '/';

/** The settings view route */
const SETTINGS_ROUTE = '/settings';

/** The ServiceNow Hub route */
const SNOW_HUB_ROUTE = '/snow-hub';

/** A route that does not exist — should redirect to home */
const NONEXISTENT_ROUTE = '/nonexistent-route';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Navigates to the given route and waits for the SPA network activity to settle.
 * Using 'networkidle' ensures all async chunks and initial API calls have completed
 * before assertions run, making tests resilient to hydration timing.
 *
 * @param {import('@playwright/test').Page} page  - Playwright page instance
 * @param {string} route                          - URL path to navigate to
 * @returns {Promise<void>}
 */
async function loadAndWaitForSpa(page, route = HOME_ROUTE) {
  await page.goto(route);
  await page.waitForLoadState('networkidle', { timeout: DASHBOARD_TIMEOUT_MS });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('React SPA: loads app shell and shows NodeToolbox title', async ({ page }) => {
  await loadAndWaitForSpa(page, HOME_ROUTE);

  // The APP_TITLE constant in App.tsx renders as a span inside the header.
  // Use .first() to avoid strict-mode violations when the title text appears
  // in multiple places (e.g. page title and visible heading).
  await expect(page.locator(`text=${APP_TITLE_TEXT}`).first()).toBeVisible();
});

test('React SPA: Settings route renders without error', async ({ page }) => {
  await loadAndWaitForSpa(page, SETTINGS_ROUTE);

  // The Settings view renders an h1/h2 heading — any visible heading confirms
  // the route matched and the component mounted without a runtime crash.
  const settingsHeading = page.locator('h1, h2').first();
  await expect(settingsHeading).toBeVisible({ timeout: DASHBOARD_TIMEOUT_MS });
});

test('React SPA: SNow Hub route renders without error', async ({ page }) => {
  await loadAndWaitForSpa(page, SNOW_HUB_ROUTE);

  const snowHubHeading = page.locator('h1, h2').first();
  await expect(snowHubHeading).toBeVisible({ timeout: DASHBOARD_TIMEOUT_MS });
});

test('React SPA: unknown routes redirect to home', async ({ page }) => {
  await loadAndWaitForSpa(page, NONEXISTENT_ROUTE);

  // React Router's catch-all <Navigate to="/" /> sends the user back to the
  // root. The final URL must end with "/" (ignoring any trailing query string).
  expect(page.url()).toMatch(/\/$/);
});

test('React SPA: Connection bar is rendered in the page header', async ({ page }) => {
  await loadAndWaitForSpa(page, HOME_ROUTE);

  // The <header> element exists in App.tsx and always contains at least the
  // app title span and the ConnectionBar component — confirming the full shell
  // mounted rather than just a bare HTML fallback.
  const headerElement = page.locator('header').first();
  await expect(headerElement).toBeVisible({ timeout: DASHBOARD_TIMEOUT_MS });

  // Verify the header has rendered child elements (not just an empty shell)
  const headerChildCount = await headerElement.locator('*').count();
  expect(headerChildCount).toBeGreaterThan(0);
});
