import { test, expect } from '@playwright/test'

test.describe('Reports Hub Filter Sanitization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5555/reports-hub', { waitUntil: 'networkidle' })
  })

  test('should render without React error #31 when filter dropdowns mount', async ({ page }) => {
    // Check that the page did not crash due to React error #31
    // The boundary would show a diagnostics panel with the error, which we should NOT see
    const runtimeDiagnosticsPanel = await page.locator('[class*="runtimeDiagnosticsPanel"]').isVisible()
    expect(runtimeDiagnosticsPanel).toBe(false)

    // Verify the filter selects are present and functional
    const piSelectLocator = page.locator('select[aria-label="PI filter"]')
    const teamSelectLocator = page.locator('select[aria-label="Team filter"]')

    expect(await piSelectLocator.count()).toBe(1)
    expect(await teamSelectLocator.count()).toBe(1)

    // Wait a moment to catch any render-time errors
    await page.waitForTimeout(2000)
  })

  test('should populate PI filter options without crashing', async ({ page }) => {
    const piSelect = page.locator('select[aria-label="PI filter"]')
    const options = await piSelect.locator('option').count()

    // Should have at least the "All PIs" default option
    expect(options).toBeGreaterThanOrEqual(1)

    // All options should have valid text content (no objects rendered as strings)
    const optionTexts = await piSelect.locator('option').allTextContents()
    for (const text of optionTexts) {
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain('[object')
    }
  })

  test('should populate Team filter options without crashing', async ({ page }) => {
    const teamSelect = page.locator('select[aria-label="Team filter"]')
    const options = await teamSelect.locator('option').count()

    // Should have at least the "All Teams" default option
    expect(options).toBeGreaterThanOrEqual(1)

    // All options should have valid text content (no objects rendered as strings)
    const optionTexts = await teamSelect.locator('option').allTextContents()
    for (const text of optionTexts) {
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain('[object')
    }
  })
})
