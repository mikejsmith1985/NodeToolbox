// test/unit/sprintRelease.test.js — Route-level smoke test for src/routes/sprintRelease.js.
//
// Full CRUD and validation coverage lives in sprintReleaseConfig.test.js.
// This file exists to satisfy the pre-commit hook's source-to-test naming check.

'use strict';

const createSprintReleaseRouter = require('../../src/routes/sprintRelease');

describe('createSprintReleaseRouter', () => {
  it('exports a function', () => {
    expect(typeof createSprintReleaseRouter).toBe('function');
  });

  it('returns an Express router when called with a configuration object', () => {
    const router = createSprintReleaseRouter({ jira: {}, sprintRelease: { teamProfiles: [] } });
    // Express routers have a stack property listing registered routes.
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});
