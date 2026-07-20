// quick-issue-lookup.spec.js — E2E proof of the F2 Quick Issue Lookup in a real browser:
// the hotkey opens the popup (focused) from any screen, a key resolves to the shared detail view with
// its full context, the key deep-links into Jira, honest states cover unknown/no-permission/invalid
// keys, input is normalized, fields save in place (and a failed write is surfaced), empty sections are
// omitted, recents persist, a new key swaps the view, F2-while-open resets, and the layout holds across
// themes / text sizes / a narrow width.
//
// Every Jira call is intercepted so no live Jira is needed (see stubJiraProxy).

'use strict';

const { test, expect } = require('@playwright/test');

const LOOKUP_DIALOG_NAME = 'Quick issue lookup';
const HOME_HEADING = 'Your personal utility belt';
const EMPTY_ISSUE_KEY = 'ENCUC-2'; // A valid key whose issue has no optional context (labels/links/etc).

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
      issuelinks: [
        { type: { name: 'Blocks', outward: 'blocks' }, outwardIssue: { key: 'ENCUC-42', fields: { status: { name: 'Done', statusCategory: { key: 'done' } }, summary: 'A blocker' } } },
      ],
      customfield_10028: 3,
    },
  };
}

// A deliberately bare issue: no labels, fix versions, links, priority, or assignee — proving the panel
// omits empty sections rather than painting empty placeholders (FR-006).
function emptyIssue(issueKey) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary: `Bare issue ${issueKey}`,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: null,
      assignee: null,
      issuetype: { name: 'Task', iconUrl: '' },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      description: null,
      labels: [],
      fixVersions: [],
      issuelinks: [],
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
      return fulfillJson(200, [{ accountId: 'acc-9', displayName: 'Casey Owner', name: 'acc-9' }]);
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
      if (issueKey === EMPTY_ISSUE_KEY) {
        return fulfillJson(200, emptyIssue(issueKey));
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

// Loads an issue into the already-open popup.
async function lookUp(page, dialog, issueKey) {
  await dialog.getByLabel('Issue key').fill(issueKey);
  await page.keyboard.press('Enter');
}

test.describe('F2 Quick Issue Lookup', () => {
  test.beforeEach(async ({ page }) => {
    await stubJiraProxy(page);
  });

  test('E1/E2: F2 opens a focused popup and a key renders the full detail view', async ({ page }) => {
    const dialog = await openLookup(page);

    // FR-001/NFR-001 — the input is focused on open, ready to type without a click.
    await expect(dialog.getByLabel('Issue key')).toBeFocused();

    await lookUp(page, dialog, 'ENCUC-1234');

    // E1 — the issue is on screen. E2 — its core facts read at a glance.
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
    await expect(dialog.getByText('In Progress')).toBeVisible();
    await expect(dialog.getByText(/High/).first()).toBeVisible();
    await expect(dialog.getByText(/Jordan, John/).first()).toBeVisible();

    // FR-005/FR-006 — the fuller context is all present: description, labels, fix versions, linked issue.
    await expect(dialog.getByText('A described issue.')).toBeVisible();
    await expect(dialog.getByText('backend')).toBeVisible();
    await expect(dialog.getByText('R1')).toBeVisible();
    await expect(dialog.getByText('Linked Issues')).toBeVisible();
    await expect(dialog.getByText('ENCUC-42')).toBeVisible();
  });

  test('E2b: an issue with no optional context omits every empty section (no placeholders)', async ({ page }) => {
    const dialog = await openLookup(page);
    await lookUp(page, dialog, EMPTY_ISSUE_KEY);

    await expect(dialog.getByText(`Bare issue ${EMPTY_ISSUE_KEY}`).first()).toBeVisible();
    // FR-006 — none of these section labels appear when their data is empty.
    await expect(dialog.getByText('Labels')).toHaveCount(0);
    await expect(dialog.getByText('Fix Versions')).toHaveCount(0);
    await expect(dialog.getByText('Linked Issues')).toHaveCount(0);
  });

  test('E4: the issue key is a one-click Jira deep-link opening in a new tab', async ({ page }) => {
    const dialog = await openLookup(page);
    await lookUp(page, dialog, 'ENCUC-1234');

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

  test('E3: editing priority in place writes to Jira without leaving', async ({ page }) => {
    const dialog = await openLookup(page);
    await lookUp(page, dialog, 'ENCUC-1234');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    await expect(dialog.getByText('Edit fields')).toBeVisible();
    const priorityRow = dialog.locator('[class*="fieldRow"]').filter({ hasText: 'Priority' });
    await priorityRow.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Priority value').selectOption({ label: 'Low' });

    const priorityWrite = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().includes('/rest/api/2/issue/ENCUC-1234'),
    );
    await priorityRow.getByRole('button', { name: 'Save' }).click();
    const writeRequest = await priorityWrite;
    expect(JSON.stringify(writeRequest.postDataJSON())).toContain('priority');

    // The popup never closed and the issue stayed on screen (no flicker back to a spinner).
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
  });

  test('E3b: editing the assignee searches users and writes the chosen account', async ({ page }) => {
    const dialog = await openLookup(page);
    await lookUp(page, dialog, 'ENCUC-1234');
    await expect(dialog.getByText('Edit fields')).toBeVisible();

    const assigneeRow = dialog.locator('[class*="fieldRow"]').filter({ hasText: 'Assignee' });
    await assigneeRow.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Assignee search').fill('casey');
    // Scope to the row — the top lookup bar also has a "Search" button.
    await assigneeRow.getByRole('button', { name: 'Search' }).click();
    await expect(dialog.getByLabel('Assignee candidate')).toBeVisible();

    const assigneeWrite = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().includes('/rest/api/2/issue/ENCUC-1234'),
    );
    await assigneeRow.getByRole('button', { name: 'Save' }).click();
    const writeRequest = await assigneeWrite;
    expect(JSON.stringify(writeRequest.postDataJSON())).toContain('assignee');
  });

  test('E3c: a failed write shows an inline error and keeps the popup open (FR-010)', async ({ page }) => {
    const dialog = await openLookup(page);
    await lookUp(page, dialog, 'ENCUC-1234');
    await expect(dialog.getByText('Edit fields')).toBeVisible();

    // Make every write fail; other calls fall back to the beforeEach stub.
    await page.route('**/jira-proxy/**', (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ errorMessages: ['Server exploded'] }) });
      }
      return route.fallback();
    });

    const summaryRow = dialog.locator('[class*="fieldRow"]').filter({ hasText: 'Summary' });
    await summaryRow.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Summary value').fill('A revised summary');
    await summaryRow.getByRole('button', { name: 'Save' }).click();

    // The failure is surfaced inline; the editor stays open (value not committed) and the popup persists.
    await expect(summaryRow.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('Summary value')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('E9: the description is shown but offers no inline editor', async ({ page }) => {
    const dialog = await openLookup(page);
    await lookUp(page, dialog, 'ENCUC-1234');
    await expect(dialog.getByText('A described issue.')).toBeVisible();

    await expect(dialog.getByText('Edit fields')).toBeVisible();
    await expect(dialog.getByText('Description', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Description value')).toHaveCount(0);
  });

  test('E7: recents show the last viewed issue and survive a reload', async ({ page }) => {
    let dialog = await openLookup(page);
    await lookUp(page, dialog, 'ENCUC-1234');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    await page.keyboard.press('F2');
    dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
    await expect(dialog.getByText('Recent')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /ENCUC-1234/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
    await page.keyboard.press('F2');
    dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
    await expect(dialog.getByRole('button', { name: /ENCUC-1234/ })).toBeVisible();
  });

  test('E8: a new key swaps the view in place, and F2-while-open resets the search', async ({ page }) => {
    const dialog = await openLookup(page);
    const input = dialog.getByLabel('Issue key');

    await lookUp(page, dialog, 'ENCUC-1234');
    await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

    // Swap in place — the persistent bar loads a new key without closing.
    await input.fill('ENCUC-5678');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Summary for ENCUC-5678').first()).toBeVisible();
    await expect(dialog.getByText('Summary for ENCUC-1234')).toHaveCount(0);

    // F2 while open resets: still a single popup, the search input cleared and re-focused.
    await dialog.getByLabel('Issue key').fill('ENCUC-9');
    await page.keyboard.press('F2');
    await expect(page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME })).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME }).getByLabel('Issue key')).toHaveValue('');
    await expect(page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME }).getByLabel('Issue key')).toBeFocused();
  });

  test('E10: the popup holds together across themes, text sizes, and a narrow width', async ({ page }) => {
    const variants = [
      { theme: 'dark', size: 'default', width: 1280 },
      { theme: 'light', size: 'extra-large', width: 1280 },
      { theme: 'light', size: 'large', width: 480 },
    ];

    await page.goto('/');
    for (const variant of variants) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.evaluate(
        ({ themeName, sizeName }) => {
          window.localStorage.setItem('tbx-theme', themeName);
          window.localStorage.setItem('tbxToolTextSize', sizeName);
        },
        { themeName: variant.theme, sizeName: variant.size },
      );
      await page.reload();

      // The chosen theme + text size are actually applied at the document root.
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await expect(page.locator('html')).toHaveAttribute('data-tool-text-size', variant.size);

      await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
      await page.keyboard.press('F2');
      const dialog = page.getByRole('dialog', { name: LOOKUP_DIALOG_NAME });
      await lookUp(page, dialog, 'ENCUC-1234');
      await expect(dialog.getByText('Summary for ENCUC-1234').first()).toBeVisible();

      // NFR-004 — the status still reads as text beside its color, not color alone.
      await expect(dialog.getByText('In Progress')).toBeVisible();
      // NFR-003 — content reflows; the document never scrolls horizontally.
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasHorizontalOverflow, `no horizontal overflow at ${variant.theme}/${variant.size}/${variant.width}`).toBe(false);
    }
  });
});
