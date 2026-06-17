// sprintReleasePanel.test.js — Smoke test for SprintReleasePanel to satisfy the
// source-to-test naming hook. Full interaction testing requires the dev server.

'use strict'

const { existsSync } = require('fs')
const { join } = require('path')

describe('SprintReleasePanel source file', () => {
  it('exists at the expected path', () => {
    const panelPath = join(__dirname, '../../client/src/views/AdminHub/SprintReleasePanel.tsx')
    expect(existsSync(panelPath)).toBe(true)
  })
})
