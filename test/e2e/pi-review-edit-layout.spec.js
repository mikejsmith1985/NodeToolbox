// test/e2e/pi-review-edit-layout.spec.js — Browser-level layout regression for the PI Review editor.
//
// Proves two edit-mode layout fixes hold in a real browser (jsdom cannot measure layout):
//   1. The Actions column stays pinned to the right edge (position: sticky) so Move / Remove /
//      grouping controls remain reachable even when the wide table is scrolled fully right — the
//      "far edge of the form is cut off" report from GH #160.
//   2. The Implementation Notes textareas default to a comfortably readable height without a
//      manual drag.
//
// The PI Review tab is reached through the PO Tool (/po-tool), which mounts the editor directly in
// authoring mode. All Confluence/Jira traffic is stubbed; team + roster state is seeded into
// localStorage before the bundle evaluates.

'use strict';

const { test, expect } = require('@playwright/test');

// ── Constants ─────────────────────────────────────────────────────────────────

const PO_TOOL_ROUTE = '/po-tool';
const PI_REVIEW_TAB_TEST_ID = 'po-tool-pireview-tab';
const SELECTED_PI_NAME = 'PI 26.4';
const TEAM_PROFILE_ID = 'team-e2e';
const CONFLUENCE_PAGE_ID = '900001';
const NETWORK_IDLE_TIMEOUT_MS = 10_000;

// A deliberately narrow viewport so the ~9-column edit-mode table is guaranteed to overflow its
// scroll container — reproducing the horizontal-scroll condition behind the cut-off report.
const NARROW_VIEWPORT = { width: 900, height: 820 };

// Minimum readable textarea height (border-box px). The CSS min-height is 132px content plus
// padding/border; 120 is a safe lower bound that still fails the old 72px default.
const MIN_READABLE_TEXTAREA_HEIGHT_PX = 120;

const SCREENSHOT_DIR =
  'C:\\Users\\mikej\\AppData\\Local\\Temp\\claude\\C--ProjectsWin-NodeToolbox\\fb0e7472-5632-4b02-9c65-013b65e2f88f\\scratchpad';

/** A PI Review table with three populated rows and plain-text feature names (no Jira keys → no
 *  Jira traffic). Header carries all eight core columns so parsePiReviewTable binds it. */
const PI_REVIEW_STORAGE_HTML = [
  '<table><thead><tr>',
  '<th>Carry-Over</th><th>Priority</th><th>Feature</th><th>Point Estimate</th>',
  '<th>Dependency</th><th>Risks</th><th>Committed to PI?</th><th>Implementation Notes</th>',
  '</tr></thead><tbody>',
  '<tr><td></td><td>High</td><td>Login flow</td><td>5</td><td></td><td></td><td>Yes</td><td>Notes one</td></tr>',
  '<tr><td></td><td>Medium</td><td>Search revamp</td><td>8</td><td></td><td></td><td>Yes</td><td>Notes two</td></tr>',
  '<tr><td></td><td>Low</td><td>Reporting</td><td>3</td><td></td><td></td><td>No</td><td>Notes three</td></tr>',
  '</tbody></table>',
].join('');

const CONFLUENCE_PAGE_RESPONSE = {
  id: CONFLUENCE_PAGE_ID,
  type: 'page',
  title: 'E2E PI Review',
  version: { number: 1 },
  body: { storage: { value: PI_REVIEW_STORAGE_HTML, representation: 'storage' } },
};

// ── Seeding helpers ─────────────────────────────────────────────────────────────

/**
 * Seeds the localStorage entries the PO Tool reads synchronously at store-module load, so a single
 * team with a PI Review page (matching the selected PI) and a Product Owner roster exist on boot.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function seedPoToolState(page) {
  await page.addInitScript(
    ({ profileId, piName, pageId }) => {
      const teamProfiles = [
        {
          id: profileId,
          name: 'E2E Team',
          projectKey: 'DASP',
          boardId: '123',
          boardName: 'E2E Board',
          boardType: 'scrum',
          scopeMode: 'sprint',
          selectedSprintId: '',
          selectedFixVersion: '',
          selectedPiValue: piName,
          piReviewPages: [{ piName, pageUrl: pageId }],
        },
      ];
      const rosterMembers = {
        rosterMembers: [
          {
            id: 'roster-member:po.user',
            displayName: 'Pat Owner',
            assigneeQueryValue: 'po.user',
            roleCapabilities: { canProductOwner: true },
          },
        ],
      };
      window.localStorage.setItem('tbxSprintDashboardTeams', JSON.stringify(teamProfiles));
      window.localStorage.setItem('tbxSprintDashboardActiveTeamProfileId', profileId);
      window.localStorage.setItem(
        'tbxPoToolSelection',
        JSON.stringify({ selectedTeamProfileId: profileId, selectedPiName: piName }),
      );
      window.localStorage.setItem(`tbxSprintDashboardRoster:${profileId}`, JSON.stringify(rosterMembers));
    },
    { profileId: TEAM_PROFILE_ID, piName: SELECTED_PI_NAME, pageId: CONFLUENCE_PAGE_ID },
  );
}

/**
 * Intercepts the Confluence page fetch (and, as a safety net, any Jira call the fake test host would
 * otherwise reject) so the editor loads deterministic rows without real integrations.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function stubIntegrationTraffic(page) {
  await page.route('**/confluence-proxy/wiki/rest/api/content/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CONFLUENCE_PAGE_RESPONSE),
    }),
  );
  await page.route('**/jira-proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ issues: [] }) }),
  );
}

/**
 * Reads an element's on-screen rectangle so the test can compare edges after scrolling.
 *
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{ left: number, right: number, width: number, height: number }>}
 */
async function readClientRect(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });
}

// ── Test ──────────────────────────────────────────────────────────────────────

test('PI Review editor: Actions column stays pinned right and Notes textareas are readable', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await seedPoToolState(page);
  await stubIntegrationTraffic(page);

  await page.goto(PO_TOOL_ROUTE);
  await page.getByTestId(PI_REVIEW_TAB_TEST_ID).click();
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });

  // The Edit toggle enables only once the Confluence table has bound — a load-completion signal.
  const editToggleButton = page.getByRole('button', { name: 'Edit PI Review' });
  await expect(editToggleButton).toBeEnabled({ timeout: NETWORK_IDLE_TIMEOUT_MS });
  await editToggleButton.click();

  // Edit mode adds the Actions column and turns the Notes cells into real textareas.
  const actionsHeader = page.getByRole('columnheader', { name: 'Actions' });
  await expect(actionsHeader).toBeVisible();

  const tableShell = page.locator('section[aria-label$="PI Review"] [class*="tableShell"]').first();
  await expect(tableShell).toBeVisible();

  // 1a. The table must actually overflow its container — otherwise there is no cut-off to guard.
  const shellScroll = await tableShell.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(shellScroll.scrollWidth).toBeGreaterThan(shellScroll.clientWidth);

  const firstRowActionCell = page.locator('section[aria-label$="PI Review"] [class*="rowActionCell"]').first();
  await expect(firstRowActionCell).toBeVisible();

  // 1b. Scrolled hard LEFT (start), the pinned Actions cell must sit fully inside the viewport —
  //     without sticky, it would be off the right edge here.
  await tableShell.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const shellRectAtStart = await readClientRect(tableShell);
  const actionRectAtStart = await readClientRect(firstRowActionCell);
  expect(actionRectAtStart.right).toBeLessThanOrEqual(shellRectAtStart.right + 1);
  expect(actionRectAtStart.left).toBeGreaterThanOrEqual(shellRectAtStart.left - 1);

  // 1c. Scrolled hard RIGHT (end), it must still be fully inside — the cut-off condition.
  await tableShell.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const shellRectAtEnd = await readClientRect(tableShell);
  const actionRectAtEnd = await readClientRect(firstRowActionCell);
  expect(actionRectAtEnd.right).toBeLessThanOrEqual(shellRectAtEnd.right + 1);
  expect(actionRectAtEnd.left).toBeGreaterThanOrEqual(shellRectAtEnd.left - 1);

  // Visual evidence, scrolled hard right — what the user sees at the "cut-off" edge, with the
  // pinned Actions column overlaid on the right.
  await tableShell.screenshot({ path: `${SCREENSHOT_DIR}\\pi-review-scrolled-right.png` });

  // 2. The Notes textarea defaults to a readable height (the old default was 72px).
  const firstNotesTextarea = page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`);
  await expect(firstNotesTextarea).toBeVisible();
  const notesRect = await readClientRect(firstNotesTextarea);
  expect(notesRect.height).toBeGreaterThanOrEqual(MIN_READABLE_TEXTAREA_HEIGHT_PX);

  // Visual evidence, scrolled hard left — Notes textarea height and the same pinned Actions rail.
  await tableShell.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await tableShell.screenshot({ path: `${SCREENSHOT_DIR}\\pi-review-scrolled-left.png` });
});
