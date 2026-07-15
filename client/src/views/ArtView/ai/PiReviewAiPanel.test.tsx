// PiReviewAiPanel.test.tsx — The panel that turns a PI Review page into a prompt, and a reply into
// suggestions the user accepts row by row.
//
// The two assertions that matter most here are the ones standing between a user and a surprise:
//   • nothing reaches a row before Accept (FR-018), and accepting never writes to Confluence (CW-4);
//   • the panel discloses that an accepted estimate can update Jira BEFORE Accept is reachable
//     (FR-030) — with no provenance tracking by design, that copy is the only safeguard.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchContexts, mockRunAiAssistExchange, mockCopyToClipboard } = vi.hoisted(() => ({
  mockFetchContexts: vi.fn(),
  mockRunAiAssistExchange: vi.fn(),
  mockCopyToClipboard: vi.fn(),
}))

vi.mock('./piReviewAiFetch.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPiReviewAiContexts: mockFetchContexts,
}))
vi.mock('../../SnowHub/hooks/useAiAssistExchange.ts', () => ({
  useAiAssistExchange: () => ({ isRunning: false, runAiAssistExchange: mockRunAiAssistExchange }),
}))
vi.mock('../../FeatureCanvas/ai/clipboard.ts', () => ({ copyToClipboard: mockCopyToClipboard }))

import { PiReviewAiPanel } from './PiReviewAiPanel.tsx'
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts'
import type { PiReviewRow } from '../piReviewTable.ts'

function row(overrides: Partial<PiReviewRow> = {}): PiReviewRow {
  return {
    rowId: 'row-1',
    carryOver: 'Yes',
    priority: 'High',
    feature: 'ALPHA-1 - Enrollment support',
    pointEstimate: '',
    dependency: 'PLAT-5 - Auth shim (In Progress)',
    risks: 'RISK-2 - Vendor SLA (Open)',
    committed: 'Yes',
    notes: '',
    devWork: '',
    testSupport: '',
    ...overrides,
  }
}

function contextFor(issueKey = 'ALPHA-1') {
  return {
    issueKey,
    summary: 'Enrollment support',
    priority: 'High',
    description: 'Body.',
    acceptanceCriteria: 'Criteria.',
    linkedDependencies: ['PLAT-5 - Auth shim (In Progress)'],
    linkedRisks: ['RISK-2 - Vendor SLA (Open)'],
    currentPointEstimate: '',
    hasExistingNotes: false,
  }
}

function replyFor(items: unknown[]) {
  return JSON.stringify({ kind: 'piReview', items })
}

function renderPanel(rows: PiReviewRow[] = [row()], onApply = vi.fn()) {
  render(<PiReviewAiPanel rows={rows} onApplySuggestion={onApply} />)
  return onApply
}

/** Waits for the on-demand context fetch to land, so the prompt (and the known-key list) is real. */
async function waitForPrompt() {
  const promptBox = await screen.findByLabelText(/prompt/i)
  await waitFor(() => expect((promptBox as HTMLTextAreaElement).value).toContain('ALPHA-1'))
  return promptBox
}

/** The review list, scoped — the pasted reply text also lives in the paste box, so global text
 *  queries would match twice. */
async function findSuggestionList() {
  return within(await screen.findByRole('list', { name: /ai suggestions/i }))
}

/** Drives the manual path: paste a reply and ingest it. */
async function ingestReply(replyText: string) {
  const pasteBox = await screen.findByPlaceholderText(/paste the assistant's json reply/i)
  fireEvent.change(pasteBox, { target: { value: replyText } })
  fireEvent.click(screen.getByRole('button', { name: /review suggestions/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  act(() => setAiAssistUnlocked(false))
  mockFetchContexts.mockResolvedValue([contextFor()])
})

// ── Gating (FR-007, FR-009) ──

describe('PiReviewAiPanel — gating', () => {
  it('renders nothing while AI Assist is locked', () => {
    const { container } = render(<PiReviewAiPanel rows={[row()]} onApplySuggestion={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
    expect(mockFetchContexts).not.toHaveBeenCalled()
  })

  it('explains there is nothing to size and never dispatches when the page has no Features', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel([])

    expect(await screen.findByText(/no features on this page/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run via ai assist/i })).not.toBeInTheDocument()
    expect(mockFetchContexts).not.toHaveBeenCalled()
  })
})

// ── The prompt is readable first (FR-010) and discloses the Jira write (FR-030) ──

describe('PiReviewAiPanel — before anything is sent', () => {
  it('shows the full prompt, copyable, before anything is sent', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel()

    const promptBox = await screen.findByLabelText(/prompt/i)
    await waitFor(() => expect((promptBox as HTMLTextAreaElement).value).toContain('ALPHA-1'))
    expect((promptBox as HTMLTextAreaElement).value).toContain('T-shirt sizing scale')
    expect(mockRunAiAssistExchange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    expect(mockCopyToClipboard).toHaveBeenCalledWith(expect.stringContaining('ALPHA-1'))
  })

  it('discloses that an accepted estimate can update Jira BEFORE any Accept exists (FR-030)', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel()

    // The disclosure must be on screen from the outset, not revealed alongside the Accept controls.
    expect(await screen.findByText(/accepted estimate can update the jira issue/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
  })

  it('never claims to write nothing to Jira — because it can', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel()

    await waitForPrompt()
    expect(screen.queryByText(/writes nothing to jira/i)).not.toBeInTheDocument()
  })
})

// ── Both paths reach one apply function (FR-011, FR-012) ──

describe('PiReviewAiPanel — the two paths', () => {
  it('turns a pasted reply into per-Feature suggestions', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel()
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M', rationale: 'Two integrations.' }]))

    const suggestionList = await findSuggestionList()
    expect(suggestionList.getByText(/two integrations/i)).toBeInTheDocument()
    expect(suggestionList.getByText('40')).toBeInTheDocument()
  })

  it('runs the automatic path into the same review UI as the manual one', async () => {
    act(() => setAiAssistUnlocked(true))
    mockRunAiAssistExchange.mockResolvedValue({
      ok: true,
      response: replyFor([{ issueKey: 'ALPHA-1', size: 'L', rationale: 'Auto path.' }]),
      message: '',
    })
    renderPanel()
    await waitForPrompt()

    fireEvent.click(screen.getByRole('button', { name: /run via ai assist/i }))

    const suggestionList = await findSuggestionList()
    expect(suggestionList.getByText(/auto path/i)).toBeInTheDocument()
    expect(suggestionList.getByText('60')).toBeInTheDocument()
  })

  it('shows a clear message when the automation fails, and leaves the manual path working (FR-012)', async () => {
    act(() => setAiAssistUnlocked(true))
    // runAiAssistExchange never throws — every failure is a returned {ok:false, message}.
    mockRunAiAssistExchange.mockResolvedValue({ ok: false, message: 'Timed out waiting for AI Assist to respond.' })
    renderPanel()
    await waitForPrompt()

    fireEvent.click(screen.getByRole('button', { name: /run via ai assist/i }))
    expect(await screen.findByText(/timed out waiting for ai assist/i)).toBeInTheDocument()

    // The manual path must still work after an automation failure.
    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'S', rationale: 'Manual still works.' }]))
    expect((await findSuggestionList()).getByText(/manual still works/i)).toBeInTheDocument()
  })

  it('surfaces a malformed reply as an error without corrupting anything', async () => {
    act(() => setAiAssistUnlocked(true))
    const onApply = renderPanel()
    await waitForPrompt()

    await ingestReply('I could not size these, sorry.')

    expect(await screen.findByRole('alert')).toHaveTextContent(/no json object/i)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('rejects a reply pasted from another AI surface outright', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel()
    await waitForPrompt()

    await ingestReply(JSON.stringify({ kind: 'agingTriage', items: [{ issueKey: 'ALPHA-1', verdict: 'close' }] }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match/i)
  })

  it('reports an unknown key and never appends it as a row (FR-021)', async () => {
    act(() => setAiAssistUnlocked(true))
    renderPanel()
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M' }, { issueKey: 'GHOST-9', size: 'S' }]))

    const ignoredNotice = await screen.findByText(/not on this page/i)
    expect(ignoredNotice).toHaveTextContent('GHOST-9')
    // The unknown key is reported, never turned into a reviewable row.
    expect((await findSuggestionList()).queryByText(/GHOST-9/)).not.toBeInTheDocument()
  })
})

// ── T032: the accept wiring (FR-018, FR-021, FR-022, CW-4, I-2) ──

describe('PiReviewAiPanel — accepting', () => {
  it('changes nothing until Accept is clicked (FR-018, invariant CW-2)', async () => {
    act(() => setAiAssistUnlocked(true))
    const onApply = renderPanel()
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M', riskNote: 'Vendor SLA unconfirmed.' }]))
    await screen.findByRole('button', { name: /^accept$/i })

    expect(onApply).not.toHaveBeenCalled()
  })

  it('applies the suggestion to its row on Accept, marking the page dirty (FR-022, I-2)', async () => {
    act(() => setAiAssistUnlocked(true))
    const onApply = renderPanel()
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M', riskNote: 'Vendor SLA unconfirmed.' }]))
    fireEvent.click(await screen.findByRole('button', { name: /^accept$/i }))

    // The panel hands the suggestion up; the tab owns the row edit and the unsaved-changes flag.
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'ALPHA-1', size: 'M', derivedPoints: 40 }))
  })

  it('never writes to Confluence when accepting (invariant CW-4)', async () => {
    act(() => setAiAssistUnlocked(true))
    const updateSpy = vi.fn()
    vi.stubGlobal('fetch', updateSpy)
    renderPanel()
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M' }]))
    fireEvent.click(await screen.findByRole('button', { name: /^accept$/i }))

    // Accepting produces an unsaved edit. Publishing stays a deliberate Save to Confluence click.
    expect(updateSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('accepting one suggestion leaves the others pending (FR-032)', async () => {
    act(() => setAiAssistUnlocked(true))
    mockFetchContexts.mockResolvedValue([contextFor('ALPHA-1'), contextFor('ALPHA-2')])
    const onApply = renderPanel([row(), row({ rowId: 'row-2', feature: 'ALPHA-2 - Second' })])
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M' }, { issueKey: 'ALPHA-2', size: 'L' }]))
    const acceptButtons = await screen.findAllByRole('button', { name: /^accept$/i })
    expect(acceptButtons).toHaveLength(2)

    fireEvent.click(acceptButtons[0])

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /^accept$/i })).toBeInTheDocument() // the other survives
  })

  it('rejecting leaves the row untouched', async () => {
    act(() => setAiAssistUnlocked(true))
    const onApply = renderPanel()
    await waitForPrompt()

    await ingestReply(replyFor([{ issueKey: 'ALPHA-1', size: 'M' }]))
    fireEvent.click(await screen.findByRole('button', { name: /^reject$/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
  })
})
