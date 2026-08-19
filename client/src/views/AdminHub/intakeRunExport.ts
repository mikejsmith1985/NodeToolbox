// intakeRunExport.ts — One copyable account of what an intake run actually did.
//
// Built for the same reason the Hygiene diagnostics were: a run gets disputed, and the dispute is
// settled by facts that live in three places — which build ran, what it was asked to do, and what
// Jira did about each email. Screenshotting those one at a time loses whichever one mattered.
//
// The section this exists for is "Refused or failed moves". A refusal — an ambiguous "Done" that
// could have meant Cancelled — reads as "nothing happened" everywhere else in the UI. Here it has
// its own heading and its own count, so the question "did the automation cancel this?" has an
// answer on the page rather than in a server log nobody is looking at.

/** One email's outcome, as the intake status endpoint reports it. */
export interface IntakeRunEvent {
  fileName?: string
  outcome?: string
  reason?: string
  jiraKey?: string | null
  eventType?: string
  message?: string
}

/** The run as the panel holds it. */
export interface IntakeRunSummary {
  hasRun: boolean
  ranAtIso?: string
  trigger?: string
  mode?: string
  postedCount?: number
  skippedCount?: number
  errorCount?: number
  folderError?: string
  events?: IntakeRunEvent[]
}

/** Reads as a refusal or failure: Jira was asked to move an issue and it did not move. */
function isRefusedMove(event: IntakeRunEvent): boolean {
  return /did not move|refus|transition failed/i.test(event.message ?? '')
}

/** One line per email: what it was, where it went, and what happened. */
function describeEvent(event: IntakeRunEvent): string {
  const parts = [
    `  ${event.fileName ?? '(unnamed file)'}`,
    `outcome=${event.outcome ?? 'unknown'}`,
    `issue=${event.jiraKey ?? '(none)'}`,
    `event=${event.eventType ?? '(none)'}`,
  ]
  const note = event.message ?? event.reason ?? ''
  return note ? `${parts.join('  ')}\n      ${note}` : parts.join('  ')
}

/**
 * Builds the plain-text report for one intake run.
 *
 * Pure: the caller supplies the version it read from the server and the run it is showing, so the
 * report can be asserted on directly.
 */
export function buildIntakeRunReport(run: IntakeRunSummary, appVersion: string | null): string {
  if (!run.hasRun) {
    return `── NodeToolbox GitHub email intake run ──\nApp version: ${appVersion ?? 'unknown'}\n\nNo intake run recorded yet.`
  }

  const events = run.events ?? []
  const refusedMoves = events.filter(isRefusedMove)

  return [
    '── NodeToolbox GitHub email intake run ──',
    `App version: ${appVersion ?? 'unknown'}`,
    `Ran at: ${run.ranAtIso ?? '(unknown)'}   trigger: ${run.trigger ?? '(unknown)'}   mode: ${run.mode ?? '(unknown)'}`,
    `Posted: ${run.postedCount ?? 0}   Skipped: ${run.skippedCount ?? 0}   Errors: ${run.errorCount ?? 0}`,
    run.folderError ? `Folder error: ${run.folderError}` : '',
    '',
    `Refused or failed moves (${refusedMoves.length}):`,
    ...(refusedMoves.length === 0 ? ['  none'] : refusedMoves.map(describeEvent)),
    '',
    `Events (${events.length}):`,
    ...(events.length === 0 ? ['  none'] : events.map(describeEvent)),
  ].filter((line) => line !== '').join('\n')
}
