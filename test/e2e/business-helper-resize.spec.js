// test/e2e/business-helper-resize.spec.js — Browser-level regression test for Business Helper column resizing.
//
// This test proves the Stablization table can be resized locally without any
// corporate integrations by measuring the live table width before and after a
// drag on the Name column handle.

'use strict';

const { test, expect } = require('@playwright/test');

const BUSINESS_HELPER_ROUTE = '/business-helper';
const STABLIZATION_TAB_TEST_ID = 'business-helper-stablization-tab';
const STABLIZATION_TABLE_TEST_ID = 'business-helper-stablization-table';
const NAME_RESIZE_HANDLE_TEST_ID = 'business-helper-resize-name';
const NETWORK_IDLE_TIMEOUT_MS = 10_000;
const DRAG_DISTANCE_PX = 180;

/**
 * Navigates to a route and waits until the SPA has finished loading network work.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} route
 * @returns {Promise<void>}
 */
async function loadRouteAndWait(page, route) {
  await page.goto(route);
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });
}

/**
 * Reads the rendered width of an element so the test can compare drag results.
 *
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<number>}
 */
async function readRenderedWidthPx(locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().width);
}

test('Business Helper: Stablization column drag widens the live table', async ({ page }) => {
  await loadRouteAndWait(page, BUSINESS_HELPER_ROUTE);

  await page.getByTestId(STABLIZATION_TAB_TEST_ID).click();
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });

  const fundingTable = page.getByTestId(STABLIZATION_TABLE_TEST_ID);
  const nameResizeHandle = page.getByTestId(NAME_RESIZE_HANDLE_TEST_ID);

  await expect(fundingTable).toBeVisible();
  await expect(nameResizeHandle).toBeVisible();

  const startingTableWidthPx = await readRenderedWidthPx(fundingTable);
  const resizeHandleBox = await nameResizeHandle.boundingBox();
  expect(resizeHandleBox).not.toBeNull();

  await page.mouse.move(resizeHandleBox.x + (resizeHandleBox.width / 2), resizeHandleBox.y + (resizeHandleBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(
    resizeHandleBox.x + (resizeHandleBox.width / 2) + DRAG_DISTANCE_PX,
    resizeHandleBox.y + (resizeHandleBox.height / 2),
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });

  const endingTableWidthPx = await readRenderedWidthPx(fundingTable);
  expect(endingTableWidthPx).toBeGreaterThan(startingTableWidthPx + 50);

  await page.screenshot({
    path: 'C:\\Users\\mikej\\.copilot\\session-state\\c38c6e54-b149-465d-824b-c239b9f2ebec\\files\\business-helper-resize-evidence.png',
    fullPage: true,
  });
});
