// test/e2e/pi-review-edit-layout.spec.js — Browser-level layout regression for tool-page width and
// the PI Review editor.
//
// jsdom cannot measure layout, so these invariants are asserted in a real browser:
//   1. Tool pages use the FULL window width at every text size (A / A+ / A++). The A+/A++ modes
//      used a `width: calc(100% / zoom)` compensation that standardized CSS zoom (Chromium 128+)
//      made obsolete — the page shrank to ~80% and left a dead right margin on every screen, which
//      is what kept "cutting off" the PI Review editor no matter how its table was styled (GH #160).
//   2. Given that full width, the PI Review edit table renders as a TABLE and fits a normal window
//      with the row Actions fully visible — including the widest 11-column configuration
//      (Dev Work + Test Support on).
//   3. When a window is genuinely too narrow for the columns, the table scrolls horizontally inside
//      its own shell — the page itself never widens or clips.
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
// The page must fill at least this fraction of the window at any text size. The zoom-width bug
// left tool pages at ~80.6% (100/1.24), so 0.95 cleanly separates fixed from broken.
const MIN_FULL_WIDTH_RATIO = 0.95;

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
async function openEditorInEditMode(page, { includeOptional, viewport, textSizeLabel }) {
  await page.setViewportSize(viewport);
  await seedPoToolState(page);
  await stubIntegrationTraffic(page, includeOptional);

  await page.goto(PO_TOOL_ROUTE);
  if (textSizeLabel) {
    await page.getByRole('button', { name: textSizeLabel, exact: true }).click();
  }
  await page.getByTestId(PI_REVIEW_TAB_TEST_ID).click();
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });

  const editToggleButton = page.getByRole('button', { name: 'Edit PI Review' });
  await expect(editToggleButton).toBeEnabled({ timeout: NETWORK_IDLE_TIMEOUT_MS });
  await editToggleButton.click();
  await expect(page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`)).toBeVisible();

  return {
    shell: page.locator('section[aria-label$="PI Review"] [class*="tableShell"]').first(),
  };
}

// ── 1. Tool pages use the full window at every text size ─────────────────────────

for (const textSize of ['Default text size', 'Large text size', 'Extra large text size']) {
  test(`full width: the tool page fills the window at "${textSize}"`, async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 950 });
    await seedPoToolState(page);
    await stubIntegrationTraffic(page, true);

    await page.goto(PO_TOOL_ROUTE);
    await page.getByRole('button', { name: textSize, exact: true }).click();
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });

    // The PO Tool's primary tab list spans the page — its painted width against the window is the
    // direct measure of the dead-right-margin bug (GH #160's real cause).
    const tabList = page.getByTestId(PI_REVIEW_TAB_TEST_ID).locator('..');
    const tabListRect = await readClientRect(tabList);
    const viewportWidth = await page.evaluate(() => window.innerWidth);

    expect(
      tabListRect.width / viewportWidth,
      `page content fills the window at "${textSize}" (was ~0.80 with the zoom-width bug)`,
    ).toBeGreaterThanOrEqual(MIN_FULL_WIDTH_RATIO);
  });
}

// ── 2. The PI Review table, given the full window ────────────────────────────────

test('table: 11 columns (Dev Work + Test Support) fit a normal window with Actions fully visible', async ({ page }) => {
  const { shell } = await openEditorInEditMode(page, {
    includeOptional: true,
    viewport: { width: 1750, height: 1000 },
  });

  // The whole table fits — no horizontal scroll needed.
  const shellScroll = await shell.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(shellScroll.scrollWidth).toBeLessThanOrEqual(shellScroll.clientWidth + FIT_TOLERANCE_PX);

  // The row Actions (the column that kept getting cut off) sit fully inside the window.
  const shellRect = await readClientRect(shell);
  const removeButton = page.getByRole('button', { name: 'Remove' }).first();
  await expect(removeButton).toBeVisible();
  const removeRect = await readClientRect(removeButton);
  expect(removeRect.right).toBeLessThanOrEqual(shellRect.right + OVERLAP_TOLERANCE_PX);

  // Notes and Actions are separate columns — Notes must end before Actions begins.
  const notesRect = await readClientRect(page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`));
  const actionRect = await readClientRect(page.locator('section[aria-label$="PI Review"] [class*="rowActionCell"]').first());
  expect(notesRect.right).toBeLessThanOrEqual(actionRect.left + OVERLAP_TOLERANCE_PX);

  await shell.screenshot({ path: `${SCREENSHOT_DIR}\\pi-review-table-11col.png` });
});

test('table: 11 columns fit at A++ text size on a large window — the reported configuration', async ({ page }) => {
  // The user's actual setup: A++ text size on a wide display. Before the zoom-width fix this page
  // only received ~80% of the window and the table clipped; now it gets all of it.
  const { shell } = await openEditorInEditMode(page, {
    includeOptional: true,
    viewport: { width: 2400, height: 1100 },
    textSizeLabel: 'Extra large text size',
  });

  const shellScroll = await shell.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(shellScroll.scrollWidth).toBeLessThanOrEqual(shellScroll.clientWidth + FIT_TOLERANCE_PX);

  const shellRect = await readClientRect(shell);
  const removeButton = page.getByRole('button', { name: 'Remove' }).first();
  await expect(removeButton).toBeVisible();
  const removeRect = await readClientRect(removeButton);
  expect(removeRect.right).toBeLessThanOrEqual(shellRect.right + OVERLAP_TOLERANCE_PX);

  await shell.screenshot({ path: `${SCREENSHOT_DIR}\\pi-review-table-11col-appzoom.png` });
});

// ── 3. Genuinely narrow windows: the shell scrolls, the page never clips ─────────

test('narrow window: the table scrolls inside its shell and the page does not widen', async ({ page }) => {
  const { shell } = await openEditorInEditMode(page, {
    includeOptional: true,
    viewport: { width: 1100, height: 900 },
  });

  // The columns cannot fit 1100px; the shell must take the overflow itself…
  const shellScroll = await shell.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(shellScroll.scrollWidth).toBeGreaterThan(shellScroll.clientWidth);

  // …while the document itself never overflows the window (the original GH #160 page-level bug).
  const documentOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(documentOverflow).toBeLessThanOrEqual(FIT_TOLERANCE_PX);

  // Scrolled to the end, the Actions column is fully visible — reachable, not cut off.
  await shell.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const shellRect = await readClientRect(shell);
  const actionRect = await readClientRect(page.locator('section[aria-label$="PI Review"] [class*="rowActionCell"]').first());
  expect(actionRect.right).toBeLessThanOrEqual(shellRect.right + OVERLAP_TOLERANCE_PX);
  expect(actionRect.left).toBeGreaterThanOrEqual(shellRect.left - OVERLAP_TOLERANCE_PX);
});
