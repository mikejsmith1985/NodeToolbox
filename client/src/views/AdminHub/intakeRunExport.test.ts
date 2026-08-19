// intakeRunExport.test.ts — The copyable account of what an intake run actually did.
//
// Written so a run can be handed over whole instead of a screenshot at a time: which build ran, the
// mode it ran in, the per-file outcome, and — the reason this exists — every event where Jira was
// asked to move an issue and did not.

import { describe, expect, it } from 'vitest'

import { buildIntakeRunReport } from './intakeRunExport.ts'

const BASE_RUN = {
  hasRun: true,
  ranAtIso: '2026-08-19T13:00:00.000Z',
  trigger: 'manual',
  mode: 'full',
  postedCount: 2,
  skippedCount: 1,
  errorCount: 1,
  events: [
    { fileName: 'a.eml', outcome: 'posted', jiraKey: 'ENFCT-9', eventType: 'pr_merged', message: 'pr merged — moved to "Done"' },
    { fileName: 'b.eml', outcome: 'posted', jiraKey: 'ENFCT-10', eventType: 'pr_merged', message: 'pr merged — did not move to "Done": ambiguous — "Done" category offers several end states (Cancelled, Closed)' },
    { fileName: 'c.eml', outcome: 'skipped', reason: 'already processed' },
  ],
}

describe('buildIntakeRunReport', () => {
  it('names the build and the mode, so a pasted run is self-describing', () => {
    const report = buildIntakeRunReport(BASE_RUN, '0.209.0')
    expect(report).toContain('0.209.0')
    expect(report).toContain('full')
  })

  it('says so plainly when the build could not be read', () => {
    expect(buildIntakeRunReport(BASE_RUN, null)).toContain('App version: unknown')
  })

  it('calls out the moves that were REFUSED, which is the whole point', () => {
    // A refusal reads as "nothing happened" everywhere else. Here it gets its own section so the
    // question "did the automation cancel this?" has an answer on the page.
    const report = buildIntakeRunReport(BASE_RUN, '0.209.0')
    expect(report).toContain('Refused or failed moves (1)')
    expect(report).toContain('ENFCT-10')
    expect(report).toContain('ambiguous')
  })

  it('reports no refusals as none, not as an empty heading', () => {
    const cleanRun = { ...BASE_RUN, events: [BASE_RUN.events[0]] }
    const report = buildIntakeRunReport(cleanRun, '0.209.0')
    expect(report).toContain('Refused or failed moves (0)')
    expect(report).toContain('none')
  })

  it('lists every file with its outcome so nothing is summarised away', () => {
    const report = buildIntakeRunReport(BASE_RUN, '0.209.0')
    expect(report).toContain('a.eml')
    expect(report).toContain('b.eml')
    expect(report).toContain('c.eml')
    expect(report).toContain('already processed')
  })

  it('says a run has not happened rather than printing an empty shell', () => {
    expect(buildIntakeRunReport({ hasRun: false }, '0.209.0')).toContain('No intake run recorded yet')
  })
})
