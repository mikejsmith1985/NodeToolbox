// po-pi-dropdown.spec.js — E2E for GH #200 US4: the PO Tool PI selector is a dropdown (P1), with an
// honest manual-entry fallback when PI options can't be loaded. Jira is stubbed.

'use strict';

const { test, expect } = require('@playwright/test');

const TEAM_PROFILE = {
  id: 'po-team-1',
  name: 'Product Team',
  projectKey: 'ENCUC',
  boardId: 1,
  boardName: 'ENCUC board',
  boardType: 'scrum',
  scopeMode: 'board',
  selectedSprintId: null,
  selectedFixVersion: '',
  selectedPiValue: 'PI 2026.3',
};

async function seedPoTool(page) {
  await page.addInitScript((profile) => {
    window.localStorage.setItem('tbxSprintDashboardTeams', JSON.stringify([profile]));
    window.localStorage.setItem(
      'tbxPoToolSelection',
      JSON.stringify({ selectedTeamProfileId: profile.id, selectedPiName: '' }),
    );
  }, TEAM_PROFILE);
}

// Stub PI-name autocomplete (populated) or empty (fallback), plus a catch-all.
async function stubPi(page, { populated }) {
  await page.route('**/jira-proxy/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/jql/autocompletedata/suggestions')) {
      return json({ results: populated ? [{ value: 'PI 2026.3' }, { value: 'PI 2026.2' }] : [] });
    }
    if (url.includes('/search')) return json({ issues: [] });
    return json({});
  });
}

test.describe('GH #200 — PO Tool PI dropdown', () => {
  test('P1: the PI control is a populated dropdown', async ({ page }) => {
    await seedPoTool(page);
    await stubPi(page, { populated: true });
    await page.goto('/agile-hub?space=product');

    const piSelect = page.locator('select#po-tool-pi');
    await expect(piSelect).toBeVisible({ timeout: 10_000 });
    await expect(piSelect.locator('option', { hasText: 'PI 2026.3' })).toHaveCount(1);

    // Picking a PI is possible; a value not in the list cannot be selected (it's a select).
    await piSelect.selectOption({ label: 'PI 2026.2' });
    await expect(piSelect).toHaveValue('PI 2026.2');
  });

  test('P1 fallback: with no loadable PIs the control degrades to a manual-entry input', async ({ page }) => {
    await seedPoTool(page);
    await stubPi(page, { populated: false });
    await page.goto('/agile-hub?space=product');

    // The dropdown degrades to a text input (never a blank locked select).
    await expect(page.locator('input#po-tool-pi')).toBeVisible({ timeout: 10_000 });
  });
});
