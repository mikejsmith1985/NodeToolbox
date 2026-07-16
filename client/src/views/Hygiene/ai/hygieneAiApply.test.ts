// hygieneAiApply.test.ts — The write half of the Hygiene AI panel's contract.
//
// Accepting one proposal must produce exactly one Jira write, routed through the same helpers the
// inline Fix controls use — and an unwritable proposal must throw a readable error, never write
// something else.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockJiraPost,
  mockSaveSimpleField,
  mockSaveStoryPoints,
  mockSaveFixVersion,
  mockSaveOptionField,
  mockFetchEditMeta,
  mockReadSelectOptions,
} = vi.hoisted(() => ({
  mockJiraPost: vi.fn(),
  mockSaveSimpleField: vi.fn(),
  mockSaveStoryPoints: vi.fn(),
  mockSaveFixVersion: vi.fn(),
  mockSaveOptionField: vi.fn(),
  mockFetchEditMeta: vi.fn(),
  mockReadSelectOptions: vi.fn(),
}))

vi.mock('../../../services/jiraApi.ts', () => ({ jiraPost: mockJiraPost }))
vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  fetchFeatureReviewEditMeta: mockFetchEditMeta,
  readFeatureReviewSelectOptions: mockReadSelectOptions,
  saveFeatureReviewFixVersion: mockSaveFixVersion,
  saveFeatureReviewOptionField: mockSaveOptionField,
  saveFeatureReviewSimpleField: mockSaveSimpleField,
  saveFeatureReviewStoryPoints: mockSaveStoryPoints,
}))

import { applyHygieneAiProposal } from './hygieneAiApply.ts'
import { resolveHygieneFieldConfig } from '../checks/hygieneChecks.ts'
import type { HygieneAiProposal } from './hygieneAiAssist.ts'

const FIELD_CONFIG = resolveHygieneFieldConfig({
  acceptanceCriteriaFieldIds: ['customfield_20001'],
  targetStartFieldIds: ['customfield_20004'],
  programIncrementFieldIds: ['customfield_10301'],
})

function proposal(overrides: Partial<HygieneAiProposal>): HygieneAiProposal {
  return { issueKey: 'TBX-1', checkId: 'missing-sp', proposedValue: '5', rationale: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockJiraPost.mockResolvedValue({})
  mockSaveSimpleField.mockResolvedValue(undefined)
  mockSaveStoryPoints.mockResolvedValue(undefined)
  mockSaveFixVersion.mockResolvedValue(undefined)
  mockSaveOptionField.mockResolvedValue(undefined)
  mockFetchEditMeta.mockResolvedValue({})
  mockReadSelectOptions.mockReturnValue([])
})

describe('applyHygieneAiProposal', () => {
  it('posts a stale nudge as a Jira comment — never a field write', async () => {
    await applyHygieneAiProposal(proposal({ checkId: 'stale', proposedValue: 'Any update on this?' }), FIELD_CONFIG)

    expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-1/comment', { body: 'Any update on this?' })
    expect(mockSaveSimpleField).not.toHaveBeenCalled()
  })

  it('routes story points through the dedicated helper', async () => {
    await applyHygieneAiProposal(proposal({ checkId: 'missing-sp', proposedValue: '8' }), FIELD_CONFIG)

    expect(mockSaveStoryPoints).toHaveBeenCalledWith('TBX-1', '8')
  })

  it('routes a fix version through the version helper, letting Jira validate the name', async () => {
    await applyHygieneAiProposal(proposal({ checkId: 'missing-fix-version', proposedValue: 'Release 26.4' }), FIELD_CONFIG)

    expect(mockSaveFixVersion).toHaveBeenCalledWith('TBX-1', 'Release 26.4')
  })

  it('writes text fixes to the flag’s resolved field', async () => {
    await applyHygieneAiProposal(
      proposal({ checkId: 'no-ac', proposedValue: 'Given X, when Y, then Z.' }),
      FIELD_CONFIG,
    )

    expect(mockSaveSimpleField).toHaveBeenCalledWith('TBX-1', 'customfield_20001', 'Given X, when Y, then Z.')
  })

  it('writes date fixes to the configured date field', async () => {
    await applyHygieneAiProposal(
      proposal({ checkId: 'missing-target-start', proposedValue: '2026-08-01' }),
      FIELD_CONFIG,
    )

    expect(mockSaveSimpleField).toHaveBeenCalledWith('TBX-1', 'customfield_20004', '2026-08-01')
  })

  it('resolves a PI proposal against Jira’s allowed options and writes the matched option', async () => {
    mockFetchEditMeta.mockResolvedValue({ customfield_10301: { allowedValues: [] } })
    mockReadSelectOptions.mockReturnValue([
      { label: 'PI 26.3 (05/21/26 - 07/29/26)', value: '10001' },
      { label: 'PI 26.4 (07/30/26 - 10/07/26)', value: '10002' },
    ])

    await applyHygieneAiProposal(
      proposal({ checkId: 'missing-pi', proposedValue: 'pi 26.4 (07/30/26 - 10/07/26)' }),
      FIELD_CONFIG,
    )

    expect(mockSaveOptionField).toHaveBeenCalledWith('TBX-1', 'customfield_10301', '10002', { allowedValues: [] })
  })

  it('throws a readable error when a PI proposal matches no allowed option — never a wrong write', async () => {
    mockFetchEditMeta.mockResolvedValue({ customfield_10301: { allowedValues: [] } })
    mockReadSelectOptions.mockReturnValue([{ label: 'PI 26.4', value: '10002' }])

    await expect(
      applyHygieneAiProposal(proposal({ checkId: 'missing-pi', proposedValue: 'PI 99.9' }), FIELD_CONFIG),
    ).rejects.toThrow(/not an allowed value.*PI 26\.4/s)
    expect(mockSaveOptionField).not.toHaveBeenCalled()
    expect(mockSaveSimpleField).not.toHaveBeenCalled()
  })

  it('falls back to a plain field write when the PI field has no options', async () => {
    mockReadSelectOptions.mockReturnValue([])

    await applyHygieneAiProposal(proposal({ checkId: 'missing-pi', proposedValue: 'PI 26.4' }), FIELD_CONFIG)

    expect(mockSaveSimpleField).toHaveBeenCalledWith('TBX-1', 'customfield_10301', 'PI 26.4')
  })

  it('throws a readable error when the flag’s field is not configured', async () => {
    // Hand-built (not via the resolver, which always merges platform defaults) so the target list
    // can actually be empty — the state a misconfigured instance would present.
    const bareConfig = { ...FIELD_CONFIG, targetStartFieldIds: [] }

    await expect(
      applyHygieneAiProposal(proposal({ checkId: 'missing-target-start', proposedValue: '2026-08-01' }), bareConfig),
    ).rejects.toThrow(/no configured Jira field/)
    expect(mockSaveSimpleField).not.toHaveBeenCalled()
  })
})
