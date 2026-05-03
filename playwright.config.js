// playwright.config.js — Playwright E2E test configuration for NodeToolbox.
//
// Runs all tests in test/e2e/ against a locally-started NodeToolbox server.
// Uses Chromium headless so tests run in CI and on Windows without a display.

'use strict';

const { defineConfig, devices } = require('@playwright/test');

const SERVER_PORT = 5556; // Use a different port than the default (5555) so tests don't conflict with a running instance
const SERVER_BASE_URL = `http://localhost:${SERVER_PORT}`;

module.exports = defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,  // Serial — one server instance serves all tests
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,

  use: {
    baseURL: SERVER_BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start NodeToolbox before running tests, shut it down after.
  // TBX_JIRA_URL + TBX_JIRA_PAT prevent the setup-wizard redirect so the
  // dashboard loads directly. The URL is a fake test domain — no real calls
  // are made during tests because Playwright intercepts the fetch calls.
  webServer: {
    command: `node server.js`,
    url: SERVER_BASE_URL,
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      TBX_PORT:     String(SERVER_PORT),
      TBX_JIRA_URL: 'https://jira.test.example.com',
      TBX_JIRA_PAT: 'e2e-test-token',
    },
  },
});
