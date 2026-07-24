// piReviewAiFetch.test.ts — Assembling the prompt's input from the page's rows plus a Jira fetch.
//
// The key design point under test: this is the AI panel's OWN on-demand fetch. It must not disturb
// DEFAULT_LINK_FIELDS (which every page load pays for) and description/AC must never reach a row.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }))

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }))

import { fetchPiReviewAiContexts } from './piReviewAiFetch.ts'
import type { PiReviewRow } from '../piReviewTable.ts'

function row(overrides: Partial<PiReviewRow> = {}): PiReviewRow {
  return {
    rowId: 'row-1',
    carryOver: '',
    priority: 'High',
    feature: 'ALPHA-1 - Enrollment support',
    pointEstimate: '',
    dependency: '',
    risks: '',
    committed: '',
    notes: '',
    devWork: '',
    testSupport: '',
    carryToNext: '',
    ...overrides,
  }
}

// Jira's /field list — the AC resolver reads this to find the instance's AC field.
const FIELD_LIST = [
  { id: 'customfield_10500', name: 'Acceptance Criteria' },
  { id: 'customfield_99999', name: 'Something Else' },
]

function issue(key: string, fields: Record<string, unknown>) {
  return { key, fields: { summary: 'Enrollment support', ...fields } }
}

describe('fetchPiReviewAiContexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the AC field id from the instance rather than hard-coding it', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [issue('ALPHA-1', { customfield_10500: 'Given a member…' })] })
    })

    const contexts = await fetchPiReviewAiContexts([row()])

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/field')
    expect(contexts[0].acceptanceCriteria).toBe('Given a member…')
  })

  it('requests description and the resolved AC field — and does so on demand, not on page load', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [issue('ALPHA-1', {})] })
    })

    await fetchPiReviewAiContexts([row()])

    const searchPath = mockJiraGet.mock.calls.map((call) => String(call[0])).find((path) => path.includes('/search'))
    expect(searchPath).toBeDefined()
    const requestedFields = decodeURIComponent(searchPath as string)
    expect(requestedFields).toContain('description')
    expect(requestedFields).toContain('customfield_10500')
  })

  it('flattens a rich-text description to plain text — tags stripped, entities decoded', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({
        issues: [issue('ALPHA-1', { description: '<p>Enrollment &amp;   billing</p><br/>  second line' })],
      })
    })

    const contexts = await fetchPiReviewAiContexts([row()])

    expect(contexts[0].description).toBe('Enrollment & billing second line')
  })

  it('flattens an ADF description object, not just a string', async () => {
    // Jira /rest/api/2 returns wiki-markup strings, but the shared helper handles ADF too, and the
    // AI panel must not care which shape an instance sends.
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({
        issues: [issue('ALPHA-1', {
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Enrollment support body.' }] }],
          },
        })],
      })
    })

    const contexts = await fetchPiReviewAiContexts([row()])

    expect(contexts[0].description).toBe('Enrollment support body.')
  })

  it('returns null — not an empty string — when description or AC is absent (FR-015)', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [issue('ALPHA-1', {})] })
    })

    const contexts = await fetchPiReviewAiContexts([row()])

    expect(contexts[0].description).toBeNull()
    expect(contexts[0].acceptanceCriteria).toBeNull()
  })

  it('splits the dependency and risks cells on newlines, not commas', async () => {
    // dedupeAndFormatLinkedIssues joins entries with \n and each is "KEY - Summary (Status)".
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [issue('ALPHA-1', {})] })
    })

    const contexts = await fetchPiReviewAiContexts([
      row({
        dependency: 'PLAT-5 - Auth shim (In Progress)\nPLAT-6 - Other, thing (Done)',
        risks: 'RISK-2 - Vendor SLA (Open)',
      }),
    ])

    expect(contexts[0].linkedDependencies).toEqual([
      'PLAT-5 - Auth shim (In Progress)',
      'PLAT-6 - Other, thing (Done)', // a comma inside a summary must not split the entry
    ])
    expect(contexts[0].linkedRisks).toEqual(['RISK-2 - Vendor SLA (Open)'])
  })

  it('carries the row context the prompt needs and NOTHING that belongs to a row', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [issue('ALPHA-1', { priority: { name: 'Highest' } })] })
    })

    const contexts = await fetchPiReviewAiContexts([row({ pointEstimate: '8', notes: 'Existing note' })])

    expect(contexts[0]).toMatchObject({
      issueKey: 'ALPHA-1',
      priority: 'Highest',
      currentPointEstimate: '8',
      hasExistingNotes: true,
    })
  })

  it('skips a row whose feature cell carries no issue key', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [] })
    })

    const contexts = await fetchPiReviewAiContexts([row({ feature: 'A hand-typed row with no key' })])

    expect(contexts).toEqual([])
  })

  it('builds ONE context per Feature when the page carries the same key on more than one row', async () => {
    // A key typed by hand onto a row a pull already added leaves the same Feature on two rows. Only one
    // context (from the first such row) must result, so the AI review shows it once — not once per row.
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [issue('ALPHA-1', { priority: { name: 'Highest' } })] })
    })

    const contexts = await fetchPiReviewAiContexts([
      row({ rowId: 'row-1', feature: 'ALPHA-1 - Enrollment support', pointEstimate: '8' }),
      row({ rowId: 'row-2', feature: 'ALPHA-1', pointEstimate: '' }), // hand-typed bare key, same Feature
    ])

    expect(contexts).toHaveLength(1)
    // The first row wins, so its context data is the one kept.
    expect(contexts[0]).toMatchObject({ issueKey: 'ALPHA-1', currentPointEstimate: '8' })
  })

  it('returns no contexts and contacts no search endpoint when there are no rows', async () => {
    const contexts = await fetchPiReviewAiContexts([])

    expect(contexts).toEqual([])
    expect(mockJiraGet).not.toHaveBeenCalled()
  })

  it('still builds contexts when the AC field lookup fails — the resolver is error-tolerant', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.reject(new Error('403'))
      return Promise.resolve({ issues: [issue('ALPHA-1', { description: 'Body text.' })] })
    })

    const contexts = await fetchPiReviewAiContexts([row()])

    expect(contexts).toHaveLength(1)
    expect(contexts[0].description).toBe('Body text.')
  })

  it('resolves the AC field ids once per fetch, not once per batch', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.resolve(FIELD_LIST)
      return Promise.resolve({ issues: [] })
    })
    const manyRows = Array.from({ length: 120 }, (_unused, index) =>
      row({ rowId: `row-${index}`, feature: `ALPHA-${index} - Feature ${index}` }))

    await fetchPiReviewAiContexts(manyRows)

    const fieldLookups = mockJiraGet.mock.calls.filter((call) => call[0] === '/rest/api/2/field')
    expect(fieldLookups).toHaveLength(1)
  })
})
