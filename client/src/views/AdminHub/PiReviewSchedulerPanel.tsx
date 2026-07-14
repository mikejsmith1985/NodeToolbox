// PiReviewSchedulerPanel.tsx — Admin Hub panel for the scheduled PI Review "Save to Confluence"
// (feature 015). Self-contained: manages its own state and talks to /api/pi-review-scheduler/* directly.
// Per team: an enable toggle, a daily HH:MM, the Product Owner assignee, the PI field id, and the PI
// Review pages (URL + PI name) to keep fresh — plus a Run-now action and last-run status.

import { useCallback, useEffect, useState } from 'react'

import styles from './AdminHubView.module.css'

// ── Types ──

interface PiReviewSchedulerPage {
  pageUrlOrId: string
  piName: string
}

interface PiReviewSchedulerTeam {
  teamName: string
  isEnabled: boolean
  scheduleTime: string
  productOwnerAssignee: string
  piFieldId: string
  dependencyLinkTypes: string[]
  pages: PiReviewSchedulerPage[]
}

interface PiReviewRunResult {
  status: string
  pageUrlOrId: string
  ranAtIso: string
  message: string
  featuresAppended?: number
  rowsReconciled?: number
}

const DEFAULT_SCHEDULE_TIME = '06:00'
const DEFAULT_PI_FIELD_ID = 'customfield_10301'

function buildDefaultTeam(): PiReviewSchedulerTeam {
  return {
    teamName: '',
    isEnabled: false,
    scheduleTime: DEFAULT_SCHEDULE_TIME,
    productOwnerAssignee: '',
    piFieldId: DEFAULT_PI_FIELD_ID,
    dependencyLinkTypes: [],
    pages: [{ pageUrlOrId: '', piName: '' }],
  }
}

// ── API helpers ──

async function fetchSchedulerConfig(): Promise<PiReviewSchedulerTeam[]> {
  const response = await fetch('/api/pi-review-scheduler/config')
  if (!response.ok) throw new Error('Failed to load PI Review scheduler config: ' + response.statusText)
  const body = await response.json() as { teams: PiReviewSchedulerTeam[] }
  return body.teams || []
}

async function saveSchedulerConfig(teams: PiReviewSchedulerTeam[]): Promise<void> {
  const response = await fetch('/api/pi-review-scheduler/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teams }),
  })
  if (!response.ok) throw new Error('Failed to save PI Review scheduler config: ' + response.statusText)
}

async function runTeamNow(teamIndex: number): Promise<{ ok: boolean; results: PiReviewRunResult[]; message?: string }> {
  const response = await fetch('/api/pi-review-scheduler/run-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamIndex }),
  })
  return response.json() as Promise<{ ok: boolean; results: PiReviewRunResult[]; message?: string }>
}

async function fetchStatus(): Promise<Record<string, PiReviewRunResult[]>> {
  const response = await fetch('/api/pi-review-scheduler/status')
  if (!response.ok) return {}
  const body = await response.json() as { teams: Record<string, PiReviewRunResult[]> }
  return body.teams || {}
}

// ── Component ──

/** Admin Hub panel that configures and monitors the per-team scheduled PI Review refresh. */
export function PiReviewSchedulerPanel() {
  const [teams, setTeams] = useState<PiReviewSchedulerTeam[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [lastRunByTeam, setLastRunByTeam] = useState<Record<string, PiReviewRunResult[]>>({})
  const [isRunningIndex, setIsRunningIndex] = useState<number | null>(null)

  const loadEverything = useCallback(async () => {
    // isLoading starts true; we avoid a synchronous setState here so this can be called from an
    // effect without cascading renders. A re-load (e.g. after Run now) simply refreshes in place.
    try {
      const [loadedTeams, loadedStatus] = await Promise.all([fetchSchedulerConfig(), fetchStatus()])
      setTeams(loadedTeams)
      setLastRunByTeam(loadedStatus)
    } catch (loadError) {
      setStatusMessage(loadError instanceof Error ? loadError.message : 'Failed to load configuration.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Defer the initial load to a macrotask (house pattern) so the effect never setStates synchronously.
  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void loadEverything() }, 0)
    return () => clearTimeout(timeoutHandle)
  }, [loadEverything])

  function updateTeam(teamIndex: number, patch: Partial<PiReviewSchedulerTeam>) {
    setTeams((currentTeams) => currentTeams.map((team, index) => (index === teamIndex ? { ...team, ...patch } : team)))
  }

  function updatePage(teamIndex: number, pageIndex: number, patch: Partial<PiReviewSchedulerPage>) {
    setTeams((currentTeams) => currentTeams.map((team, index) => {
      if (index !== teamIndex) return team
      const pages = team.pages.map((page, pIndex) => (pIndex === pageIndex ? { ...page, ...patch } : page))
      return { ...team, pages }
    }))
  }

  function addTeam() {
    setTeams((currentTeams) => [...currentTeams, buildDefaultTeam()])
  }

  function removeTeam(teamIndex: number) {
    setTeams((currentTeams) => currentTeams.filter((_team, index) => index !== teamIndex))
  }

  function addPage(teamIndex: number) {
    updateTeam(teamIndex, { pages: [...teams[teamIndex].pages, { pageUrlOrId: '', piName: '' }] })
  }

  function removePage(teamIndex: number, pageIndex: number) {
    updateTeam(teamIndex, { pages: teams[teamIndex].pages.filter((_page, index) => index !== pageIndex) })
  }

  async function handleSave() {
    setIsSaving(true)
    setStatusMessage('')
    try {
      await saveSchedulerConfig(teams)
      setStatusMessage('Saved.')
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRunNow(teamIndex: number) {
    setIsRunningIndex(teamIndex)
    setStatusMessage('')
    try {
      const outcome = await runTeamNow(teamIndex)
      setStatusMessage(outcome.ok ? 'Run complete.' : (outcome.message || 'Run finished with errors.'))
      await loadEverything()
    } catch (runError) {
      setStatusMessage(runError instanceof Error ? runError.message : 'Run failed.')
    } finally {
      setIsRunningIndex(null)
    }
  }

  if (isLoading) {
    return <p>Loading PI Review scheduler…</p>
  }

  return (
    <div className={styles.panelSection}>
      <h2>🗓️ PI Review Sync</h2>
      <p>
        Refresh each team&apos;s PI Review Confluence page from Jira on a daily schedule — the manual
        <strong> Save to Confluence</strong> button still works for urgent updates. A run appends the team&apos;s
        PO+PI Features and refreshes the Jira-owned columns, preserving all your manual content. Runs reuse the
        server&apos;s existing Jira/Confluence credentials.
      </p>

      {teams.length === 0 && <p>No teams scheduled yet. Add one below.</p>}

      {teams.map((team, teamIndex) => (
        <fieldset key={teamIndex} className={styles.panelCard}>
          <div>
            <label>
              <input
                type="checkbox"
                aria-label={`Enable schedule for team ${teamIndex + 1}`}
                checked={team.isEnabled}
                onChange={(event) => updateTeam(teamIndex, { isEnabled: event.target.checked })}
              />
              {' '}Enabled
            </label>
          </div>
          <label>Team name
            <input
              aria-label={`Team name ${teamIndex + 1}`}
              value={team.teamName}
              onChange={(event) => updateTeam(teamIndex, { teamName: event.target.value })}
            />
          </label>
          <label>Schedule time (HH:MM)
            <input
              aria-label={`Schedule time ${teamIndex + 1}`}
              value={team.scheduleTime}
              onChange={(event) => updateTeam(teamIndex, { scheduleTime: event.target.value })}
            />
          </label>
          <label>Product Owner (assignee)
            <input
              aria-label={`Product Owner ${teamIndex + 1}`}
              value={team.productOwnerAssignee}
              onChange={(event) => updateTeam(teamIndex, { productOwnerAssignee: event.target.value })}
            />
          </label>
          <label>PI field id
            <input
              aria-label={`PI field id ${teamIndex + 1}`}
              value={team.piFieldId}
              onChange={(event) => updateTeam(teamIndex, { piFieldId: event.target.value })}
            />
          </label>

          <p><strong>PI Review pages</strong></p>
          {team.pages.map((page, pageIndex) => (
            <div key={pageIndex}>
              <input
                aria-label={`Page URL ${teamIndex + 1}-${pageIndex + 1}`}
                placeholder="Confluence page URL or id"
                value={page.pageUrlOrId}
                onChange={(event) => updatePage(teamIndex, pageIndex, { pageUrlOrId: event.target.value })}
              />
              <input
                aria-label={`Page PI ${teamIndex + 1}-${pageIndex + 1}`}
                placeholder="PI name (exact match)"
                value={page.piName}
                onChange={(event) => updatePage(teamIndex, pageIndex, { piName: event.target.value })}
              />
              <button type="button" onClick={() => removePage(teamIndex, pageIndex)}>Remove page</button>
            </div>
          ))}
          <button type="button" onClick={() => addPage(teamIndex)}>+ Add page</button>

          <div className={styles.panelActions}>
            <button
              type="button"
              disabled={isRunningIndex === teamIndex}
              onClick={() => void handleRunNow(teamIndex)}
            >
              {isRunningIndex === teamIndex ? 'Running…' : 'Run now'}
            </button>
            <button type="button" onClick={() => removeTeam(teamIndex)}>Remove team</button>
          </div>

          {(lastRunByTeam[team.teamName] || []).map((result, resultIndex) => (
            <p key={resultIndex} className={styles.panelStatusLine}>
              Last run: <strong>{result.status}</strong> · {result.pageUrlOrId} · {result.ranAtIso}
              {result.message ? ` — ${result.message}` : ''}
            </p>
          ))}
        </fieldset>
      ))}

      <div className={styles.panelActions}>
        <button type="button" onClick={addTeam}>+ Add team</button>
        <button type="button" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? 'Saving…' : 'Save schedules'}
        </button>
      </div>

      {statusMessage && <p role="status" className={styles.panelStatusLine}>{statusMessage}</p>}
    </div>
  )
}
