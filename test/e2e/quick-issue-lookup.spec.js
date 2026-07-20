// quick-issue-lookup.spec.js — E2E proof of the F2 Quick Issue Lookup in a real browser:
// the hotkey opens the popup from any screen, a key resolves to the shared detail view, the key
// deep-links into Jira, honest states cover unknown/no-permission/invalid keys, input is normalized,
// a field edit saves in place, recents persist across a reload, and a new key swaps the view.
//
// Every Jira call is intercepted so no live Jira is needed (see stubJiraProxy).

'use strict';

const { test, expect } = require('@playwright/test');

const LOOKUP_DIALOG_NAME = 'Quick issue lookup';
const HOME_HEADING = 'Your personal utility belt';

// A fully-populated issue so the detail panel renders every fact the lookup promises.
function fullIssue(issueKey) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary: `Summary for ${issueKey}`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High', iconUrl: '' },
      assignee: { displayName: 'Jordan, John', accountId: 'acc-1' },
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      description: 'A described issue.',
      labels: ['backend'],
      fixVersions: [{ name: 'R1' }],
      customfield_10028: 3,
    },
  };
}

// Route every proxied Jira call: single-issue GET by key, editmeta, transitions, comments, user
// search, and field writes. Two keys are special: an unknown key 404s and FORBIDDEN-1 403s.
async function stubJiraProxy(page) {
  await page.route('**/jira-proxy/**', (route) => {
    const requestUrl = route.request().url();
    const fulfillJson = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (requestUrl.includes('/editmeta')) {
      return fulfillJson(200, {
        fields: {
          summary: { name: 'Summary' },
          priority: { name: 'Priority', allowedValues: [{ id: '2', value: 'High' }, { id: '3', value: 'Low' }] },
          assignee: { name: 'Assignee' },
        },
      });
    }
    if (requestUrl.includes('/transitions')) {
      return fulfillJson(200, { transitions: [] });
    }
    if (requestUrl.includes('/comment')) {
      return fulfillJson(200, { comments: [], total: 0 });
    }
    if (requestUrl.includes('/user')) {
      return fulfillJson(200, []);
    }
    if (route.request().method() === 'PUT') {
      return fulfillJson(204, {});
    }

    const issueMatch = requestUrl.match(/\/rest\/api\/2\/issue\/([^/?]+)\?/i);
    if (issueMatch) {
      const issueKey = decodeURIComponent(issueMatch[1]).toUpperCase();
      if (issueKey === 'ENCUC-9999999') {
        return fulfillJson(404, { errorMessages: ['Issue does not exist'] });
      }
      if (issueKey === 'FORBIDDEN-1') {
        return fulfillJson(403, { errorMessages: ['No permission'] });
      }
      return fulfillJson(200, fullIssue(issueKey));
    }

    return fulfillJson(200, {});
  });
}

// Opens the F2 popup from the home screen and returns the dialog locator.
async function openLookup(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
  await page.keyboard.press('F2');
  const dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('F2 Quick Issue Lookup', () => {
  test.beforeEach(async ({ page }) => {
    await stubJiraProxy(page);
  });

  test('E1/E2: F2 opens the popup and a key renders the detail view with its core facts', async ({ page }) => {
    const dialog = await openLookup(page);

    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');

    // E1 — the issue is on screen (summary appears both as the heading and as the editable field's
    // current value, so scope to the first). E2 — its core facts read at a glance.
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
    await expect(dialog.getByText('In Progress')).toBeVisible();
    // Priority and assignee each appear twice (header chip + editable field value) — scope to first.
    await expect(dialog.getByText(/High/).first()).toBeVisible();
    await expect(dialog.getByText(/Jordan, John/).first()).toBeVisible();
  });

  test('E4: the issue key is a one-click Jira deep-link opening in a new tab', async ({ page }) => {
    const dialog = await openLookup(page);
    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');

    const jiraLink = dialog.getByRole('link', { name: /ENCUC-1234/ });
    await expect(jiraLink).toHaveAttribute('href', /\/browse\/ENCUC-1234$/);
    await expect(jiraLink).toHaveAttribute('target', '_blank');
  });

  test('E5: unknown, no-permission, and invalid keys each show a distinct honest state', async ({ page }) => {
    const dialog = await openLookup(page);
    const input = dialog.getByLabel('Issue key');

    await input.fill('ENCUC-9999999');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(/No issue found for ENCUC-9999999/)).toBeVisible();

    await input.fill('FORBIDDEN-1');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(/don't have access to FORBIDDEN-1/)).toBeVisible();

    await input.fill('hello world');
    await dialog.getByRole('button', { name: 'Search' }).click();
    await expect(dialog.getByText(/Enter an issue key like ABC-123/)).toBeVisible();
  });

  test('E6: whitespace and a pasted browse URL both resolve to the same issue', async ({ page }) => {
    const dialog = await openLookup(page);
    const input = dialog.getByLabel('Issue key');

    await input.fill('  encuc-1234  ');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    await input.fill('https://jira.test.example.com/browse/encuc-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
  });

  test('E3: editing priority in place saves and confirms without leaving', async ({ page }) => {
    const dialog = await openLookup(page);
    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    // The Priority editor lives in the "Edit fields" section (enabled because editmeta allows it).
    await expect(dialog.getByText('Edit fields')).toBeVisible();
    const priorityRow = dialog.locator('[class*="fieldRow"]').filter({ hasText: 'Priority' });
    await priorityRow.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Priority value').selectOption({ label: 'Low' });

    // Proof the edit reached Jira: a PUT to this issue writing the priority field. (The Saved flash is
    // transient because the successful save refetches the issue and remounts the panel.)
    const priorityWrite = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().includes('/rest/api/2/issue/ENCUC-1234'),
    );
    await priorityRow.getByRole('button', { name: 'Save' }).click();
    const writeRequest = await priorityWrite;
    expect(JSON.stringify(writeRequest.postDataJSON())).toContain('priority');

    // The popup never closed — the issue re-renders in place after the save.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
  });

  test('E9: the description is shown but offers no inline editor', async ({ page }) => {
    const dialog = await openLookup(page);
    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('A described issue.')).toBeVisible();

    // The editable section covers summary/priority/assignee — never a description editor.
    await expect(dialog.getByText('Edit fields')).toBeVisible();
    await expect(dialog.getByText('Description', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Description value')).toHaveCount(0);
  });

  test('E7: recents show the last viewed issue and survive a reload', async ({ page }) => {
    let dialog = await openLookup(page);
    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reopen — the recents list carries the just-viewed issue.
    await page.keyboard.press('F2');
    dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
    await expect(dialog.getByText('Recent')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /ENCUC-1234/ })).toBeVisible();

    // Persist across a full reload (localStorage).
    await page.reload();
    await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
    await page.keyboard.press('F2');
    dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
    await expect(dialog.getByRole('button', { name: /ENCUC-1234/ })).toBeVisible();
  });

  test('E8: a new key in the persistent bar swaps the view in place', async ({ page }) => {
    const dialog = await openLookup(page);
    const input = dialog.getByLabel('Issue key');

    await input.fill('ENCUC-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    await input.fill('ENCUC-5678');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-5678').first()).toBeVisible();
    await expect(dialog.getByText('Summary for ENCUC-1234')).toHaveCount(0);
  });

  test('E10: the popup holds together at a narrow width without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    const dialog = await openLookup(page);
    await dialog.getByLabel('Issue key').fill('ENCUC-1234');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    // The document body must never scroll horizontally (standing responsive rule).
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
