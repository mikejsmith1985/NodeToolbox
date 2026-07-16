// test/e2e/pi-review-edit-layout.spec.js — Browser-level layout regression for the PI Review editor.
//
// jsdom cannot measure layout, so these invariants are asserted in a real browser:
//   1. The edit-mode table FITS a normal window — its read-only Jira-synced columns (Dependency,
//      Risks) take a compact width so the editable columns and the Actions column stay inside the
//      frame, rather than overflowing and pushing Actions off the right edge (the GH #160 report).
//   2. The Actions column NEVER overlaps the Implementation Notes column. An earlier fix pinned
//      Actions with position:sticky, which then covered the Notes cell the user was editing; this
//      guards against that regression by asserting Notes always sits fully left of Actions.
//   3. The Implementation Notes textareas default to a readable height.
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

// A typical modern content width. At this size the edit-mode table is meant to fit without a
// horizontal scrollbar; that "fits" claim is asserted below rather than assumed.
const CONTENT_VIEWPORT = { width: 1600, height: 860 };

// Small allowances for sub-pixel rounding in getBoundingClientRect / scrollWidth.
const FIT_TOLERANCE_PX = 8;
const OVERLAP_TOLERANCE_PX = 2;

// Minimum readable textarea height (border-box px). The CSS min-height is 132px content plus
// padding/border; 120 is a safe lower bound that still fails the old 72px default.
const MIN_READABLE_TEXTAREA_HEIGHT_PX = 120;

const SCREENSHOT_DIR =
  'C:\\Users\\mikej\\AppData\\Local\\Temp\\claude\\C--ProjectsWin-NodeToolbox\\fb0e7472-5632-4b02-9c65-013b65e2f88f\\scratchpad';

// A long note so the Implementation Notes cell is genuinely used — the column that the removed
// sticky overlay used to cover.
const LONG_NOTE = 'Risk note availability could interrupt downstream enrollment and create rework '
  + 'across teams if the vendor window slips again this PI.';

/** A PI Review table with three populated rows and plain-text feature names (no Jira keys → no
 *  Jira traffic). Header carries all eight core columns so parsePiReviewTable binds it. */
const PI_REVIEW_STORAGE_HTML = [
  '<table><thead><tr>',
  '<th>Carry-Over</th><th>Priority</th><th>Feature</th><th>Point Estimate</th>',
  '<th>Dependency</th><th>Risks</th><th>Committed to PI?</th><th>Implementation Notes</th>',
  '</tr></thead><tbody>',
  `<tr><td></td><td>High</td><td>Login flow</td><td>5</td><td></td><td></td><td>Yes</td><td>${LONG_NOTE}</td></tr>`,
  `<tr><td></td><td>Medium</td><td>Search revamp</td><td>8</td><td></td><td></td><td>Yes</td><td>${LONG_NOTE}</td></tr>`,
  `<tr><td></td><td>Low</td><td>Reporting</td><td>3</td><td></td><td></td><td>No</td><td>${LONG_NOTE}</td></tr>`,
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
 * Reads an element's on-screen rectangle so the test can compare column edges.
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

test('PI Review editor: table fits, Actions never covers Notes, Notes are readable', async ({ page }) => {
  await page.setViewportSize(CONTENT_VIEWPORT);
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

  // 1. The table fits this normal window — Actions is reachable without a horizontal scroll.
  const shellScroll = await tableShell.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(shellScroll.scrollWidth).toBeLessThanOrEqual(shellScroll.clientWidth + FIT_TOLERANCE_PX);

  // 2. The Actions column never overlaps the Implementation Notes column, at either scroll extreme.
  const firstNotesCell = page.getByLabel(`Implementation Notes for ${SELECTED_PI_NAME} row 1`);
  const firstRowActionCell = page.locator('section[aria-label$="PI Review"] [class*="rowActionCell"]').first();
  await expect(firstNotesCell).toBeVisible();
  await expect(firstRowActionCell).toBeVisible();

  for (const scrollLeft of ['start', 'end']) {
    await tableShell.evaluate((element, edge) => {
      element.scrollLeft = edge === 'end' ? element.scrollWidth : 0;
    }, scrollLeft);
    const notesRect = await readClientRect(firstNotesCell);
    const actionRect = await readClientRect(firstRowActionCell);
    // Notes must end at or before Actions begins — never hidden behind it.
    expect(notesRect.right, `Notes must not be covered by Actions at scroll ${scrollLeft}`)
      .toBeLessThanOrEqual(actionRect.left + OVERLAP_TOLERANCE_PX);
  }

  // 3. The Notes textarea defaults to a readable height (the old default was 72px).
  const notesRect = await readClientRect(firstNotesCell);
  expect(notesRect.height).toBeGreaterThanOrEqual(MIN_READABLE_TEXTAREA_HEIGHT_PX);

  // Visual evidence for manual review.
  await tableShell.screenshot({ path: `${SCREENSHOT_DIR}\\pi-review-edit-layout.png` });
});
