// test/e2e/pi-review-edit-layout.spec.js — Browser-level layout regression for the PI Review editor.
//
// jsdom cannot measure layout, so these invariants are asserted in a real browser:
//   1. On a wide-enough window the editor renders as a TABLE and fits — Actions reachable, and never
//      overlapping the Implementation Notes column.
//   2. When the columns cannot fit (e.g. all 11 columns, incl. Dev Work + Test Support, on a normal
//      window — the exact config from the GH #160 report), the same table REFLOWS into stacked
//      cards: no horizontal overflow, every field still present and editable, and the row Actions
//      (incl. Remove) fully visible — nothing cut off.
//   3. The switch adapts to the column count: 8 columns stay a table at a width where 11 become cards.
//
// The PI Review tab is reached through the PO Tool (/po-tool). All Confluence/Jira traffic is
// stubbed; team + roster state is seeded into localStorage before the bundle evaluates.

'use strict';

const { test, expect } = require('@playwright/test');

// ── Constants ─────────────────────────────────────────────────────────────────

const PO_TOOL_ROUTE = '/po-tool';
const PI_REVIEW_TAB_TEST_ID = 'po-tool-pireview-tab';
const SELECTED_PI_NAME = 'PI 26.4';
const TEAM_PROFILE_ID = 'team-e2e';
const CONFLUENCE_PAGE_ID = '900001';
const NETWORK_IDLE_TIMEOUT_MS = 10_000;

const FIT_TOLERANCE_PX = 8;
const OVERLAP_TOLERANCE_PX = 2;
const MIN_READABLE_TEXTAREA_HEIGHT_PX = 120;

const SCREENSHOT_DIR =
  'C:\\Users\\mikej\\AppData\\Local\\Temp\\claude\\C--ProjectsWin-NodeToolbox\\fb0e7472-5632-4b02-9c65-013b65e2f88f\\scratchpad';

const LONG_NOTE = 'Risk note: API authentication, availability, or file retrieval failures could '
  + 'interrupt enrollment intake and create manual operational work.';

const CORE_HEADERS = [
  'Carry-Over', 'Priority', 'Feature', 'Point Estimate',
  'Dependency', 'Risks', 'Committed to PI?', 'Implementation Notes',
];
const OPTIONAL_HEADERS = ['Dev Work', 'Test Support'];

/** Builds a PI Review table with the given optional columns present and three populated rows. */
function buildStorageHtml(includeOptional) {
  const headers = includeOptional ? [...CORE_HEADERS, ...OPTIONAL_HEADERS] : CORE_HEADERS;
  const headerCells = headers.map((label) => `<th>${label}</th>`).join('');
  const coreCells = (feature, points, note) => [
    '<td></td>', '<td>High</td>', `<td>${feature}</td>`, `<td>${points}</td>`,
    '<td></td>', '<td></td>', '<td>Yes</td>', `<td>${note}</td>`,
  ].join('');
  const optionalCells = '<td>Yes</td><td></td>';
  const row = (feature, points) =>
    `<tr>${coreCells(feature, points, LONG_NOTE)}${includeOptional ? optionalCells : ''}</tr>`;
  return [
    `<table><thead><tr>${headerCells}</tr></thead><tbody>`,
    row('DENP-1382 Automate CMS OEC downloads', '40'),
    row('DENP-1387 Enhance IPM duplicate matching', '40'),
    row('DENP-1393 H Contract migration', '80'),
    '</tbody></table>',
  ].join('');
}

// ── Seeding helpers ─────────────────────────────────────────────────────────────

async function seedPoToolState(page) {
  await page.addInitScript(
    ({ profileId, piName, pageId }) => {
      window.localStorage.setItem('tbxSprintDashboardTeams', JSON.stringify([{
        id: profileId, name: 'E2E Team', projectKey: 'DASP', boardId: '123', boardName: 'E2E Board',
        boardType: 'scrum', scopeMode: 'sprint', selectedSprintId: '', selectedFixVersion: '',
        selectedPiValue: piName, piReviewPages: [{ piName, pageUrl: pageId }],
      }]));
      window.localStorage.setItem('tbxSprintDashboardActiveTeamProfileId', profileId);
      window.localStorage.setItem('tbxPoToolSelection', JSON.stringify({ selectedTeamProfileId: profileId, selectedPiName: piName }));
      window.localStorage.setItem(`tbxSprintDashboardRoster:${profileId}`, JSON.stringify({ rosterMembers: [] }));
    },
    { profileId: TEAM_PROFILE_ID, piName: SELECTED_PI_NAME, pageId: CONFLUENCE_PAGE_ID },
  );
}

async function stubIntegrationTraffic(page, includeOptional) {
  const pageResponse = {
    id: CONFLUENCE_PAGE_ID, type: 'page', title: 'E2E PI Review', version: { number: 1 },
    body: { storage: { value: buildStorageHtml(includeOptional), representation: 'storage' } },
  };
  await page.route('**/confluence-proxy/wiki/rest/api/content/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageResponse) }));
  await page.route('**/jira-proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ issues: [] }) }));
}

async function readClientRect(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });
}

/** Navigates to the PI Review editor in edit mode and returns the key locators. */
async function openEditorInEditMode(page, { includeOptional, viewport }) {
  await page.setViewportSize(viewport);
  await seedPoToolState(page);
  await stubIntegrationTraffic(page, includeOptional);

  await page.goto(PO_TOOL_ROUTE);
  await page.getByTestId(PI_REVIEW_TAB_TEST_ID).click();
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });

  const editToggleButton = page.getByRole('button', { name: 'Edit PI Review' });
  await expect(editToggleButton).toBeEnabled({ timeout: NETWORK_IDLE_TIMEOUT_MS });
  await editToggleButton.click();
  // Edit-mode-ready signal that exists in BOTH the table and the card layout (the Actions column
  // header is hidden in card mode, so it can't be the signal).
  await expect(page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`)).toBeVisible();

  return {
    table: page.locator('section[aria-label$="PI Review"] [class*="dataTable"]').first(),
    shell: page.locator('section[aria-label$="PI Review"] [class*="tableShell"]').first(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('table path: 8 columns on a wide window render as a table that fits, Actions beside Notes', async ({ page }) => {
  // 1900px is wide enough for the 8-column table, so it should NOT reflow to cards.
  const { table, shell } = await openEditorInEditMode(page, {
    includeOptional: false,
    viewport: { width: 1900, height: 900 },
  });

  await expect(table).not.toHaveClass(/cardLayout/);

  const shellScroll = await shell.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(shellScroll.scrollWidth).toBeLessThanOrEqual(shellScroll.clientWidth + FIT_TOLERANCE_PX);

  // As a table, Notes and Actions are separate columns — Notes must end before Actions begins.
  const notesCell = page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`);
  const actionCell = page.locator('section[aria-label$="PI Review"] [class*="rowActionCell"]').first();
  const notesRect = await readClientRect(notesCell);
  const actionRect = await readClientRect(actionCell);
  expect(notesRect.right).toBeLessThanOrEqual(actionRect.left + OVERLAP_TOLERANCE_PX);
  expect(notesRect.height).toBeGreaterThanOrEqual(MIN_READABLE_TEXTAREA_HEIGHT_PX);
});

test('table path: 11 columns still render as a table when the window is genuinely wide enough', async ({ page }) => {
  // At 2200px the 11-column table fits, so it stays a table with no horizontal overflow — the wide
  // screen keeps the scannable grid.
  const { table, shell } = await openEditorInEditMode(page, {
    includeOptional: true,
    viewport: { width: 2200, height: 1000 },
  });

  await expect(table).not.toHaveClass(/cardLayout/);
  const shellScroll = await shell.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(shellScroll.scrollWidth).toBeLessThanOrEqual(shellScroll.clientWidth + FIT_TOLERANCE_PX);
});

test('card path: 11 columns on a normal window reflow to cards — nothing cut off (GH #160)', async ({ page }) => {
  // The reported config — Dev Work + Test Support on — at a width where the 11-column table cannot
  // fit. It must reflow to cards rather than clip the Actions column. (A 2091px physical screenshot
  // at Windows 150% scaling is ~1400 CSS px, which is where the user actually was.)
  const { table, shell } = await openEditorInEditMode(page, {
    includeOptional: true,
    viewport: { width: 1400, height: 1000 },
  });

  await expect(table).toHaveClass(/cardLayout/);

  // No horizontal overflow — the whole editor fits the window width in card form.
  const shellScroll = await shell.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(shellScroll.scrollWidth).toBeLessThanOrEqual(shellScroll.clientWidth + FIT_TOLERANCE_PX);

  const shellRect = await readClientRect(shell);

  // Every field is still present and editable, and each sits fully inside the window.
  const notesTextarea = page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`);
  const devWorkCheckbox = page.getByLabel(`Dev Work for ${SELECTED_PI_NAME} row 1`);
  await expect(notesTextarea).toBeVisible();
  await expect(devWorkCheckbox).toBeVisible();

  // The Dev Work checkbox still toggles — proof the reflow did not break the control.
  await devWorkCheckbox.uncheck();
  await expect(devWorkCheckbox).not.toBeChecked();
  await devWorkCheckbox.check();
  await expect(devWorkCheckbox).toBeChecked();

  // The row Actions — the column that was cut off — are fully visible inside the window.
  const removeButton = page.getByRole('button', { name: 'Remove' }).first();
  await expect(removeButton).toBeVisible();
  const removeRect = await readClientRect(removeButton);
  expect(removeRect.right).toBeLessThanOrEqual(shellRect.right + OVERLAP_TOLERANCE_PX);
  expect(removeRect.left).toBeGreaterThanOrEqual(shellRect.left - OVERLAP_TOLERANCE_PX);

  await shell.screenshot({ path: `${SCREENSHOT_DIR}\\pi-review-cards-11col.png` });
});

test('adapts to column count: at 1850px 11 columns become cards while 8 stay a table', async ({ page }) => {
  // Same window width; only the column count differs — proving the switch is column-aware, not a
  // fixed viewport breakpoint. 8 columns fit at 1850px (table); 11 do not (cards).
  const eightColumns = await openEditorInEditMode(page, { includeOptional: false, viewport: { width: 1850, height: 1000 } });
  await expect(eightColumns.table).not.toHaveClass(/cardLayout/);

  const elevenColumns = await openEditorInEditMode(page, { includeOptional: true, viewport: { width: 1850, height: 1000 } });
  await expect(elevenColumns.table).toHaveClass(/cardLayout/);
});
