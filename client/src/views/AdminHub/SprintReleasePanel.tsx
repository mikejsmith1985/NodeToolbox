// SprintReleasePanel.tsx — Admin Hub config panel for the Sprint–Release Workflow Orchestrator.
//
// Lets administrators configure the team profile that drives automated dev-issue Done transitions,
// QE/BT handoff comments, sprint–FixVersion date sync, defect intake, and DoR violation gating.

import { useCallback, useEffect, useState } from 'react'

import styles from './AdminHubView.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HandoffDelivery {
  webhookUrl:    string
  webhookSecret: string
}

interface SprintReleaseProfile {
  teamProfileId:            string
  isEnabled:                boolean
  featureProjectKey:        string
  devProjectKey:            string
  qeProjectKey:             string
  btProjectKey:             string
  boardId:                  number
  subStatusFieldId:         string
  qeHandoffSubStatusValue:  string
  btHandoffSubStatusValue:  string
  configOnlyLabel:          string
  defectIntakeLabel:        string
  freezeWindowBusinessDays: number
  doneTransitionName:       string
  dorQeFieldId:             string
  dorBtFieldId:             string
  handoffDelivery:          HandoffDelivery
  pollIntervalMinutes:      number
}

interface SprintReleaseStatus {
  teamProfileId:      string
  isEnabled:          boolean
  lastPollAt:         string | null
  nextPollAt:         string | null
  activeSprintName:   string | null
  activeSprintEndDate: string | null
  recentHandoffs:     { issueKey: string; handoffType: string; postedAt: string }[]
  sprintSyncWarnings: string[]
}

interface WorkflowTopologyProject {
  role:        'feature' | 'dev' | 'qe' | 'bt'
  isReachable: boolean
  issueTypes:  { name: string; isSubtask: boolean }[]
  allStatuses: string[]
}

interface WorkflowTopologyValidationEntry {
  configuredValue: string
  isFound:         boolean
}

interface WorkflowTopologyData {
  projects:              Record<string, WorkflowTopologyProject>
  devTransitions:        { transitionId: string; transitionName: string; toStatusName: string }[]
  subStatusFieldOptions: string[]
  validation: {
    qeHandoffSubStatusValue: WorkflowTopologyValidationEntry
    btHandoffSubStatusValue: WorkflowTopologyValidationEntry
    doneTransitionName:      WorkflowTopologyValidationEntry
  }
  fetchedAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: SprintReleaseProfile = {
  teamProfileId:            'default',
  isEnabled:                true,
  featureProjectKey:        '',
  devProjectKey:            '',
  qeProjectKey:             '',
  btProjectKey:             '',
  boardId:                  0,
  subStatusFieldId:         'customfield_10201',
  qeHandoffSubStatusValue:  'Ready for System Integration Test',
  btHandoffSubStatusValue:  'Ready for UAT',
  configOnlyLabel:          'no-testing-required',
  defectIntakeLabel:        'defect-intake',
  freezeWindowBusinessDays: 13,
  doneTransitionName:       'Done',
  dorQeFieldId:             '',
  dorBtFieldId:             '',
  handoffDelivery:          { webhookUrl: '', webhookSecret: '' },
  pollIntervalMinutes:      5,
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchProfile(): Promise<SprintReleaseProfile> {
  const response = await fetch('/api/sprint-release/config')
  if (!response.ok) throw new Error('Failed to load Sprint–Release config')
  return response.json() as Promise<SprintReleaseProfile>
}

async function saveProfile(profile: SprintReleaseProfile): Promise<{ saved: boolean; error?: string; validatedProjects?: string[] }> {
  const response = await fetch('/api/sprint-release/config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(profile),
  })
  return response.json() as Promise<{ saved: boolean; error?: string; validatedProjects?: string[] }>
}

async function fetchStatus(): Promise<SprintReleaseStatus> {
  const response = await fetch('/api/sprint-release/status')
  if (!response.ok) throw new Error('Failed to load status')
  return response.json() as Promise<SprintReleaseStatus>
}

async function triggerPollNow(): Promise<void> {
  await fetch('/api/sprint-release/run-now', { method: 'POST' })
}

async function fetchWorkflowTopology(): Promise<WorkflowTopologyData> {
  const response = await fetch('/api/sprint-release/workflow-topology')
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(errorBody.error ?? 'Failed to fetch workflow topology')
  }
  return response.json() as Promise<WorkflowTopologyData>
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Admin Hub panel for configuring the Sprint–Release Workflow Orchestrator. */
export function SprintReleasePanel() {
  const [profile, setProfile] = useState<SprintReleaseProfile>(DEFAULT_PROFILE)
  const [status, setStatus] = useState<SprintReleaseStatus | null>(null)
  const [topologyData, setTopologyData] = useState<WorkflowTopologyData | null>(null)
  // Starts true: the panel loads on mount, so the spinner is the honest first paint.
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunningNow, setIsRunningNow] = useState(false)
  const [isValidatingTopology, setIsValidatingTopology] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Load the profile and status once, on mount.
  //
  // Every setState happens after the fetches settle, never while the effect body runs: the state
  // already says loading, so announcing it again would only force a second render and flash the
  // empty panel first. isActive stops a late response updating a panel the admin has left.
  useEffect(() => {
    let isActive = true

    Promise.all([fetchProfile(), fetchStatus()])
      .then(([loadedProfile, loadedStatus]) => {
        if (!isActive) return
        setProfile(loadedProfile)
        setStatus(loadedStatus)
        setErrorMessage(null)
      })
      .catch((loadError: unknown) => {
        if (isActive) setErrorMessage((loadError as Error).message)
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => { isActive = false }
  }, [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveMessage(null)
    setErrorMessage(null)
    try {
      const result = await saveProfile(profile)
      if (result.saved) {
        const validatedList = result.validatedProjects ? ` (validated: ${result.validatedProjects.join(', ')})` : ''
        setSaveMessage(`Saved.${validatedList}`)
        setTimeout(() => setSaveMessage(null), 4000)
      } else {
        setErrorMessage(result.error ?? 'Save failed.')
      }
    } catch (saveError) {
      setErrorMessage((saveError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }, [profile])

  const handleRunNow = useCallback(async () => {
    setIsRunningNow(true)
    try {
      await triggerPollNow()
      setSaveMessage('Poll cycle triggered.')
      setTimeout(() => setSaveMessage(null), 3000)
    } catch {
      setErrorMessage('Failed to trigger poll cycle.')
    } finally {
      setIsRunningNow(false)
    }
  }, [])

  const handleValidateTopology = useCallback(async () => {
    setIsValidatingTopology(true)
    setErrorMessage(null)
    try {
      const topology = await fetchWorkflowTopology()
      setTopologyData(topology)
    } catch (topologyError) {
      setErrorMessage((topologyError as Error).message)
    } finally {
      setIsValidatingTopology(false)
    }
  }, [])

  function setField<K extends keyof SprintReleaseProfile>(fieldName: K, value: SprintReleaseProfile[K]) {
    setProfile((previous) => ({ ...previous, [fieldName]: value }))
  }

  function setDeliveryField(fieldName: keyof HandoffDelivery, value: string) {
    setProfile((previous) => ({
      ...previous,
      handoffDelivery: { ...previous.handoffDelivery, [fieldName]: value },
    }))
  }

  if (isLoading) {
    return <div className={styles.sectionCard}>Loading Sprint–Release config…</div>
  }

  return (
    <div className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🚀 Sprint–Release Workflow</h2>
      <p className={styles.adminDescription}>
        Automates dev-issue Done transitions and QE/BT handoff comments when a sub-status field
        changes, syncs sprint end dates to FixVersion release dates, creates defect issues from
        intake labels, and gates Definition of Ready compliance. The scheduler polls Jira at the
        configured interval.
      </p>

      {errorMessage && <p className={styles.errorBanner} role="alert">⚠ {errorMessage}</p>}
      {saveMessage  && <p className={styles.successBanner} role="status">{saveMessage}</p>}

      {/* ── Enable toggle ── */}
      <label className={styles.fieldLabel}>
        <input
          type="checkbox"
          checked={profile.isEnabled}
          onChange={(changeEvent) => setField('isEnabled', changeEvent.target.checked)}
          style={{ marginRight: '0.5rem' }}
        />
        Enabled
      </label>

      {/* ── Project Keys ── */}
      <div className={styles.inputRow}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-feature-key">Feature Project Key</label>
          <input
            id="sr-feature-key"
            className={styles.textInput}
            value={profile.featureProjectKey}
            placeholder="e.g. DENP"
            onChange={(changeEvent) => setField('featureProjectKey', changeEvent.target.value.toUpperCase())}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-dev-key">Dev Project Key</label>
          <input
            id="sr-dev-key"
            className={styles.textInput}
            value={profile.devProjectKey}
            placeholder="e.g. ENFCT"
            onChange={(changeEvent) => setField('devProjectKey', changeEvent.target.value.toUpperCase())}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-qe-key">QE Project Key</label>
          <input
            id="sr-qe-key"
            className={styles.textInput}
            value={profile.qeProjectKey}
            placeholder="e.g. INTTEST"
            onChange={(changeEvent) => setField('qeProjectKey', changeEvent.target.value.toUpperCase())}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-bt-key">BT Project Key</label>
          <input
            id="sr-bt-key"
            className={styles.textInput}
            value={profile.btProjectKey}
            placeholder="e.g. UEFT"
            onChange={(changeEvent) => setField('btProjectKey', changeEvent.target.value.toUpperCase())}
          />
        </div>
      </div>

      {/* ── Board and sub-status ── */}
      <div className={styles.inputRow}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-board-id">Jira Board ID</label>
          <input
            id="sr-board-id"
            className={styles.textInput}
            type="number"
            min={1}
            value={profile.boardId || ''}
            placeholder="e.g. 42"
            onChange={(changeEvent) => setField('boardId', parseInt(changeEvent.target.value, 10) || 0)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-sub-status-field">Sub-Status Field ID</label>
          <input
            id="sr-sub-status-field"
            className={styles.textInput}
            value={profile.subStatusFieldId}
            placeholder="customfield_10201"
            onChange={(changeEvent) => setField('subStatusFieldId', changeEvent.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-poll-interval">Poll Interval (minutes)</label>
          <input
            id="sr-poll-interval"
            className={styles.textInput}
            type="number"
            min={1}
            value={profile.pollIntervalMinutes}
            onChange={(changeEvent) => setField('pollIntervalMinutes', parseInt(changeEvent.target.value, 10) || 5)}
          />
        </div>
      </div>

      {/* ── Handoff trigger values ── */}
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="sr-qe-trigger">QE Handoff Sub-Status Value</label>
        <input
          id="sr-qe-trigger"
          className={styles.textInput}
          value={profile.qeHandoffSubStatusValue}
          placeholder="Ready for System Integration Test"
          onChange={(changeEvent) => setField('qeHandoffSubStatusValue', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="sr-bt-trigger">BT Handoff Sub-Status Value</label>
        <input
          id="sr-bt-trigger"
          className={styles.textInput}
          value={profile.btHandoffSubStatusValue}
          placeholder="Ready for UAT"
          onChange={(changeEvent) => setField('btHandoffSubStatusValue', changeEvent.target.value)}
        />
      </div>

      {/* ── Labels and transitions ── */}
      <div className={styles.inputRow}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-config-only-label">Config-Only Label (no handoff)</label>
          <input
            id="sr-config-only-label"
            className={styles.textInput}
            value={profile.configOnlyLabel}
            placeholder="no-testing-required"
            onChange={(changeEvent) => setField('configOnlyLabel', changeEvent.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-defect-intake-label">Defect Intake Label</label>
          <input
            id="sr-defect-intake-label"
            className={styles.textInput}
            value={profile.defectIntakeLabel}
            placeholder="defect-intake"
            onChange={(changeEvent) => setField('defectIntakeLabel', changeEvent.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-done-transition">Done Transition Name</label>
          <input
            id="sr-done-transition"
            className={styles.textInput}
            value={profile.doneTransitionName}
            placeholder="Done"
            onChange={(changeEvent) => setField('doneTransitionName', changeEvent.target.value)}
          />
        </div>
      </div>

      {/* ── Code freeze and DoR ── */}
      <div className={styles.inputRow}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-freeze-days">Freeze Window (business days before release)</label>
          <input
            id="sr-freeze-days"
            className={styles.textInput}
            type="number"
            min={1}
            value={profile.freezeWindowBusinessDays}
            onChange={(changeEvent) => setField('freezeWindowBusinessDays', parseInt(changeEvent.target.value, 10) || 13)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-dor-qe-field">DoR QE Criteria Field ID (optional)</label>
          <input
            id="sr-dor-qe-field"
            className={styles.textInput}
            value={profile.dorQeFieldId}
            placeholder="Leave blank to skip DoR QE gate"
            onChange={(changeEvent) => setField('dorQeFieldId', changeEvent.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="sr-dor-bt-field">DoR BT Scenarios Field ID (optional)</label>
          <input
            id="sr-dor-bt-field"
            className={styles.textInput}
            value={profile.dorBtFieldId}
            placeholder="Leave blank to skip DoR BT gate"
            onChange={(changeEvent) => setField('dorBtFieldId', changeEvent.target.value)}
          />
        </div>
      </div>

      {/* ── Handoff delivery webhook ── */}
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="sr-webhook-url">Handoff Delivery Webhook URL (optional)</label>
        <input
          id="sr-webhook-url"
          className={styles.textInput}
          value={profile.handoffDelivery.webhookUrl}
          placeholder="POST handoff events to this webhook in addition to the Jira comment"
          onChange={(changeEvent) => setDeliveryField('webhookUrl', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="sr-webhook-secret">Handoff Webhook Secret (write-only)</label>
        <input
          id="sr-webhook-secret"
          className={styles.textInput}
          type="password"
          value={profile.handoffDelivery.webhookSecret}
          placeholder="Leave blank to keep existing"
          autoComplete="new-password"
          onChange={(changeEvent) => setDeliveryField('webhookSecret', changeEvent.target.value)}
        />
      </div>

      {/* ── Actions ── */}
      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.saveButton}
          disabled={isSaving}
          onClick={() => { void handleSave() }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          disabled={isRunningNow}
          onClick={() => { void handleRunNow() }}
        >
          {isRunningNow ? '⏳ Running…' : '▶ Run Now'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          disabled={isValidatingTopology}
          onClick={() => { void handleValidateTopology() }}
        >
          {isValidatingTopology ? '🔍 Validating…' : '🔍 Validate Workflow'}
        </button>
      </div>

      {/* ── Workflow topology diagram ── */}
      {topologyData && (
        <WorkflowTopologyCard topology={topologyData} subStatusFieldId={profile.subStatusFieldId} />
      )}

      {/* ── Runtime status ── */}
      {status && (
        <SprintReleaseStatusCard status={status} />
      )}
    </div>
  )
}

// ── Status card ───────────────────────────────────────────────────────────────

interface SprintReleaseStatusCardProps {
  status: SprintReleaseStatus
}

// ── Workflow topology card ────────────────────────────────────────────────────

/** Role labels shown on each project column header. */
const PROJECT_ROLE_LABELS: Record<string, string> = {
  feature: 'Feature',
  dev:     'Dev',
  qe:      'QE',
  bt:      'BT',
}

interface WorkflowTopologyCardProps {
  topology:         WorkflowTopologyData
  subStatusFieldId: string
}

/**
 * Renders the live workflow topology fetched from Jira — project columns with issue
 * types and statuses, the sub-status field options with trigger-value highlights,
 * the dev project's available transitions, and a validation summary showing whether
 * each configured rule value actually exists in Jira.
 */
function WorkflowTopologyCard({ topology, subStatusFieldId }: WorkflowTopologyCardProps) {
  const { projects, devTransitions, subStatusFieldOptions, validation, fetchedAt } = topology
  const projectEntries = Object.entries(projects).sort(([, projectA], [, projectB]) => {
    const roleOrder: Record<string, number> = { feature: 0, dev: 1, qe: 2, bt: 3 }
    return (roleOrder[projectA.role] ?? 9) - (roleOrder[projectB.role] ?? 9)
  })

  const validationEntries: { label: string; entry: WorkflowTopologyValidationEntry }[] = [
    { label: 'QE Handoff trigger',  entry: validation.qeHandoffSubStatusValue },
    { label: 'BT Handoff trigger',  entry: validation.btHandoffSubStatusValue },
    { label: 'Done transition name', entry: validation.doneTransitionName },
  ]

  const allRulesAreValid = validationEntries.every(({ entry }) => entry.isFound)

  return (
    <div className={styles.teamBlock} aria-label="Workflow topology diagram">
      <div className={styles.teamBlockHeader}>
        <strong className={styles.teamBlockTitle}>Workflow Topology</strong>
        <span style={{ fontSize: '0.75rem', color: '#888', marginLeft: '0.75rem' }}>
          fetched {new Date(fetchedAt).toLocaleTimeString()}
        </span>
        {allRulesAreValid
          ? <span style={{ marginLeft: '0.75rem', color: '#22c55e', fontWeight: 600 }}>✓ All rules supported</span>
          : <span style={{ marginLeft: '0.75rem', color: '#ef4444', fontWeight: 600 }}>✗ Config mismatches found</span>
        }
      </div>

      {/* ── Project columns ── */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        {projectEntries.map(([projectKey, projectData]) => (
          <div
            key={projectKey}
            style={{
              border: projectData.isReachable ? '1px solid #3b5998' : '1px solid #ef4444',
              borderRadius: '6px',
              padding: '0.6rem 0.9rem',
              minWidth: '160px',
              background: projectData.isReachable ? '#1a2035' : '#2a1010',
              flex: '1 1 160px',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: '#93c5fd' }}>
              {PROJECT_ROLE_LABELS[projectData.role] ?? projectData.role}: {projectKey}
              {!projectData.isReachable && <span style={{ color: '#ef4444', marginLeft: '0.4rem' }}>✗ unreachable</span>}
            </div>
            {projectData.issueTypes.filter((issueType) => !issueType.isSubtask).map((issueType) => (
              <div key={issueType.name} style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>• {issueType.name}</div>
            ))}
            {projectData.allStatuses.length > 0 && (
              <details style={{ marginTop: '0.4rem' }}>
                <summary style={{ fontSize: '0.75rem', cursor: 'pointer', color: '#64748b' }}>
                  {projectData.allStatuses.length} statuses
                </summary>
                {projectData.allStatuses.map((statusName) => (
                  <div key={statusName} style={{ fontSize: '0.75rem', color: '#64748b', paddingLeft: '0.5rem' }}>
                    {statusName}
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
      </div>

      <div className={styles.notificationTeamFields}>

        {/* ── Sub-status field options ── */}
        {subStatusFieldOptions.length > 0 && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Sub-Status field ({subStatusFieldId}) options</span>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {subStatusFieldOptions.map((optionValue) => {
                const isQeTrigger = optionValue === validation.qeHandoffSubStatusValue.configuredValue
                const isBtTrigger = optionValue === validation.btHandoffSubStatusValue.configuredValue
                const isHighlighted = isQeTrigger || isBtTrigger
                return (
                  <li key={optionValue} style={{ color: isHighlighted ? '#22c55e' : 'inherit', fontWeight: isHighlighted ? 600 : 400 }}>
                    {optionValue}
                    {isQeTrigger && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#86efac' }}>← QE trigger</span>}
                    {isBtTrigger && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#86efac' }}>← BT trigger</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {subStatusFieldOptions.length === 0 && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Sub-Status field ({subStatusFieldId}) options</span>
            <span style={{ color: '#f59e0b' }}>⚠ No options found — verify the field ID is correct for the dev project</span>
          </div>
        )}

        {/* ── Dev project transitions ── */}
        {devTransitions.length > 0 && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Dev project transitions (sample issue)</span>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {devTransitions.map((transition) => {
                const isConfiguredDoneTransition = transition.transitionName === validation.doneTransitionName.configuredValue
                return (
                  <li key={transition.transitionId} style={{ color: isConfiguredDoneTransition ? '#22c55e' : 'inherit', fontWeight: isConfiguredDoneTransition ? 600 : 400 }}>
                    {transition.transitionName} → {transition.toStatusName}
                    {isConfiguredDoneTransition && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#86efac' }}>← configured Done transition</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {devTransitions.length === 0 && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Dev project transitions</span>
            <span style={{ color: '#f59e0b' }}>⚠ Could not fetch transitions — dev project may have no issues yet</span>
          </div>
        )}

        {/* ── Validation summary ── */}
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Validation</span>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {validationEntries.map(({ label, entry }) => (
              <li key={label} style={{ color: entry.isFound ? '#22c55e' : '#ef4444' }}>
                {entry.isFound ? '✓' : '✗'} {label}: <em>"{entry.configuredValue}"</em>
                {!entry.isFound && <span style={{ marginLeft: '0.5rem', color: '#fca5a5' }}>— not found in Jira</span>}
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  )
}

// ── Status card ───────────────────────────────────────────────────────────────

/** Read-only runtime status card showing recent activity and sprint sync state. */
function SprintReleaseStatusCard({ status }: SprintReleaseStatusCardProps) {
  return (
    <div className={styles.teamBlock} aria-label="Sprint–Release runtime status">
      <div className={styles.teamBlockHeader}>
        <strong className={styles.teamBlockTitle}>Runtime Status</strong>
      </div>

      <div className={styles.notificationTeamFields}>
        {status.activeSprintName && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Active Sprint</span>
            <span>{status.activeSprintName}{status.activeSprintEndDate ? ` — ends ${status.activeSprintEndDate}` : ''}</span>
          </div>
        )}
        {status.lastPollAt && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Last Poll</span>
            <span>{new Date(status.lastPollAt).toLocaleString()}</span>
          </div>
        )}
        {status.recentHandoffs.length > 0 && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Recent Handoffs</span>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {status.recentHandoffs.slice(0, 5).map((handoff) => (
                <li key={`${handoff.issueKey}-${handoff.postedAt}`}>
                  <strong>{handoff.issueKey}</strong> — {handoff.handoffType}
                </li>
              ))}
            </ul>
          </div>
        )}
        {status.sprintSyncWarnings.length > 0 && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Sprint Sync Warnings</span>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {status.sprintSyncWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
