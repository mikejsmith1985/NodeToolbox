// SprintReleasePanel.test.tsx — Smoke test verifying the component module exports correctly.
// Full interaction tests require a running dev server against a live Jira instance.

import { SprintReleasePanel } from './SprintReleasePanel.tsx'

describe('SprintReleasePanel', () => {
  it('exports SprintReleasePanel as a function', () => {
    expect(typeof SprintReleasePanel).toBe('function')
  })
})
