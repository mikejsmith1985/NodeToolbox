// todo-quick-add.spec.js — E2E proof that the F1 to-do quick-add works in a real browser:
// the hotkey opens the popup from any screen (suppressing the browser Help default), a typed
// item lands in the persistent list, and the My Issues → Today dashboard manages it.

'use strict';

const { test, expect } = require('@playwright/test');

test.describe('F1 to-do quick-add', () => {
  test.beforeEach(async ({ page }) => {
    // Stub every proxied backend call so the app shell loads without a live Jira.
    await page.route('**/jira-proxy/**', (route) => route.fulfill({ json: { issues: [] } }));
    await page.route('**/confluence-proxy/**', (route) => route.fulfill({ json: {} }));
  });

  test('F1 opens the popup from the home screen and the item appears on the Today dashboard', async ({ page }) => {
    await page.goto('/');
    // The F1 listener attaches after React mounts — wait for the rendered shell first.
    await expect(page.getByRole('heading', { name: 'Your personal utility belt' })).toBeVisible();

    await page.keyboard.press('F1');
    const quickAddDialog = page.getByRole('dialog', { name: 'Add to-do item' });
    await expect(quickAddDialog).toBeVisible();

    await quickAddDialog.getByLabel('To-do item').fill('Book the PI planning room');
    await page.keyboard.press('Enter');
    await expect(quickAddDialog.getByText(/Added ✓/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(quickAddDialog).not.toBeVisible();

    await page.goto('/my-issues?tab=today');
    await expect(page.getByRole('checkbox', { name: 'Book the PI planning room' })).toBeVisible();
    await expect(page.getByText('1 open · 0 done')).toBeVisible();
  });

  test('the list survives a reload (localStorage persistence)', async ({ page }) => {
    await page.goto('/my-issues?tab=today');

    await page.getByLabel('New to-do item').fill('Survives restarts');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Survives restarts' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Survives restarts' })).toBeVisible();
  });
});
