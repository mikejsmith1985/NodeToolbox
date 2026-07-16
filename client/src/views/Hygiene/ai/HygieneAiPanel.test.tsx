// HygieneAiPanel.test.tsx — The review gate for AI hygiene fixes.
//
// Every proposal passes through here, and the user accepts or declines each one individually.
// These tests are what make "nothing reaches Jira without your click" true.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApplyProposal, mockRunExchange } = vi.hoisted(() => ({
  mockApplyProposal: vi.fn(),
  mockRunExchange: vi.fn(),
}))

vi.mock('./hygieneAiApply.ts', () => ({ applyHygieneAiProposal: mockApplyProposal }))
vi.mock('../../SnowHub/hooks/useAiAssistExchange.ts', () => ({
  useAiAssistExchange: () => ({ isRunning: false, runAiAssistExchange: mockRunExchange }),
}))

import { act } from '@testing-library/react'

import { HygieneAiPanel } from './HygieneAiPanel.tsx'
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts'
import { resolveHygieneFieldConfig, type HygieneFinding } from '../checks/hygieneChecks.ts'

const FIELD_CONFIG = resolveHygieneFieldConfig()

function finding(issueKey: string, checkIds: string[]): HygieneFinding {
  return {
    issue: {
      key: issueKey,
      fields: { summary: 'A summary', issuetype: { name: 'Story' }, description: 'Context.' },
    } as HygieneFinding['issue'],
    flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })) as HygieneFinding['flags'],
    programIncrement: null,
  }
}

function replyFor(issueKey: string): string {
  return JSON.stringify({
    kind: 'hygiene',
    items: [{ issueKey, fixes: [{ checkId: 'missing-sp', value: '5', rationale: 'Small change.' }] }],
  })
}

function renderPanel(findings: HygieneFinding[] = [finding('TBX-1', ['missing-sp'])], onIssueFixed = vi.fn()) {
  render(<HygieneAiPanel fieldConfig={FIELD_CONFIG} findings={findings} onIssueFixed={onIssueFixed} />)
  return onIssueFixed
}

/** Ingests a reply through the shell's paste box so proposals appear for review. */
function ingestReply(replyText: string) {
  fireEvent.change(screen.getByLabelText('AI Assist hygiene fixes reply'), { target: { value: replyText } })
  fireEvent.click(screen.getByRole('button', { name: /review proposals/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApplyProposal.mockResolvedValue(undefined)
  // The shared shell (ReportAiPanel) renders null while AI Assist is locked; these tests exercise
  // the unlocked panel. The gate itself is covered by the shell's own tests.
  act(() => setAiAssistUnlocked(true))
})

describe('HygieneAiPanel', () => {
  it('shows a quiet note instead of the panel when nothing on the page is AI-fixable', () => {
    renderPanel([finding('TBX-1', ['no-assignee'])])

    expect(screen.getByText(/No AI-fixable flags/i)).toBeInTheDocument()
    expect(screen.queryByText(/AI Assist hygiene fixes/i)).not.toBeInTheDocument()
  })

  it('discloses that accepting writes to Jira before any Accept exists', () => {
    renderPanel()

    expect(screen.getByText(/accepting writes that one field \(or comment\) to Jira immediately/i)).toBeInTheDocument()
  })

  it('lists ingested proposals with value and rationale, writing nothing yet', () => {
    renderPanel()
    ingestReply(replyFor('TBX-1'))

    // Scoped to the proposal list — the pasted reply text still sits in the ingest textarea.
    const proposalList = within(screen.getByLabelText('AI fix proposals'))
    expect(proposalList.getByText('TBX-1')).toBeInTheDocument()
    expect(proposalList.getByText('5')).toBeInTheDocument()
    expect(proposalList.getByText(/small change/i)).toBeInTheDocument()
    expect(mockApplyProposal).not.toHaveBeenCalled()
  })

  it('applies exactly the accepted proposal and reports the fix so the page rescans', async () => {
    const onIssueFixed = renderPanel()
    ingestReply(replyFor('TBX-1'))

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))

    await waitFor(() => expect(screen.getByText(/applied/i)).toBeInTheDocument())
    expect(mockApplyProposal).toHaveBeenCalledTimes(1)
    expect(mockApplyProposal).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'TBX-1', checkId: 'missing-sp', proposedValue: '5' }),
      FIELD_CONFIG,
    )
    expect(onIssueFixed).toHaveBeenCalledWith('TBX-1')
  })

  it('declining removes the proposal and never writes', () => {
    const onIssueFixed = renderPanel()
    ingestReply(replyFor('TBX-1'))

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }))

    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
    expect(mockApplyProposal).not.toHaveBeenCalled()
    expect(onIssueFixed).not.toHaveBeenCalled()
  })

  it('shows the write error on the row when Jira rejects an accepted fix', async () => {
    mockApplyProposal.mockRejectedValue(new Error('Field update rejected'))
    const onIssueFixed = renderPanel()
    ingestReply(replyFor('TBX-1'))

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/rejected/i))
    expect(onIssueFixed).not.toHaveBeenCalled()
    // The row survives with its error so the user can retry or decline.
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeInTheDocument()
  })

  it('reports proposals for issues not on the page instead of listing them', () => {
    renderPanel()
    ingestReply(replyFor('EVIL-9'))

    expect(screen.getByText(/ignored proposals for/i)).toHaveTextContent('EVIL-9')
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
  })

  it('surfaces a parse error without losing the panel', () => {
    renderPanel()
    ingestReply('this is not json')

    expect(screen.getByText(/AI Assist hygiene fixes/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
