// statusMoveWriter.test.ts — Proves a card move either happens properly or is reported properly.
//
// The case worth reading first is the two-step partial failure. When Jira will not let the status
// and the sub-status be written together, the status change can succeed while the sub-status write
// fails. Snapping the card back would then draw a state Jira does not hold — the board would be
// lying, which is the one thing this whole feature exists to stop. So it settles at the truth and
// says exactly what did and did not apply.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchTransitions, mockSaveTransition, mockSaveOptionField, mockJiraGet } = vi.hoisted(() => ({
  mockFetchTransitions: vi.fn(),
  mockSaveTransition: vi.fn(),
  mockSaveOptionField: vi.fn(),
  mockJiraGet: vi.fn(),
}));

vi.mock('../featureReviewFixes.ts', () => ({
  fetchFeatureReviewTransitions: mockFetchTransitions,
  saveFeatureReviewTransition: mockSaveTransition,
  saveFeatureReviewOptionField: mockSaveOptionField,
  fetchFeatureReviewEditMeta: vi.fn(),
  isTransitionFieldSupported: (field: { schemaType: string }) =>
    ['option', 'option-with-child', 'string'].includes(field.schemaType),
  areTransitionSelectionsComplete: () => true,
  buildTransitionFieldsPayload: () => ({}),
}));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { executeStatusMove, planStatusMove } from './statusMoveWriter.ts';
import type { ColumnStatusMapping } from './rollupBoardTypes.ts';

const SUB_STATUS_FIELD = 'customfield_10201';

/** A transition to "In Progress" whose screen also carries the sub-status field. */
const TRANSITION_WITH_SUB_STATUS = {
  id: '31',
  name: 'Start Progress',
  to: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
  requiredFields: [],
  screenFieldIds: [SUB_STATUS_FIELD],
};

/** The same destination, but the sub-status is NOT on the transition screen. */
const TRANSITION_WITHOUT_SUB_STATUS = {
  id: '31',
  name: 'Start Progress',
  to: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
  requiredFields: [],
  screenFieldIds: [],
};

const TARGET: ColumnStatusMapping = { jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveTransition.mockResolvedValue(undefined);
  mockSaveOptionField.mockResolvedValue(undefined);
});

describe('planStatusMove — choosing how to write', () => {
  it('writes both values in ONE request when the sub-status is on the transition screen', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      transitions: [TRANSITION_WITH_SUB_STATUS],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('transition-with-substatus');
  });

  it('falls back to two steps only when Jira leaves no alternative', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      transitions: [TRANSITION_WITHOUT_SUB_STATUS],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('transition-then-field');
  });

  it('transitions alone when the target column claims no sub-status', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: null },
      transitions: [TRANSITION_WITHOUT_SUB_STATUS],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('transition-only');
  });

  it('sets only the field when the status is already right and just the sub-status differs', () => {
    const plan = planStatusMove({
      currentStatusName: 'In Progress',
      currentSubStatusValue: 'Dev In Progress',
      targetMapping: TARGET,
      transitions: [],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('field-only');
  });

  it('does nothing at all when the card is already where it was dropped', () => {
    const plan = planStatusMove({
      currentStatusName: 'In Progress',
      currentSubStatusValue: 'Dev Complete',
      targetMapping: TARGET,
      transitions: [],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('no-op');
  });

  it('refuses up front when no transition reaches the target status', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'Accepted', subStatusValue: null },
      transitions: [TRANSITION_WITH_SUB_STATUS],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('refused');
    expect(plan.kind === 'refused' && plan.reason).toContain('Accepted');
  });

  it('degrades to a plain transition when this instance has no sub-status field', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      transitions: [TRANSITION_WITHOUT_SUB_STATUS],
      subStatusFieldId: '',
    });

    expect(plan.kind).toBe('transition-only');
  });

  it('holds the move when the transition demands fields the viewer has not answered', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: null },
      transitions: [{
        ...TRANSITION_WITHOUT_SUB_STATUS,
        requiredFields: [{ fieldId: 'customfield_20001', name: 'Defect Root Cause', schemaType: 'option', allowedValues: [] }],
      }],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('needs-fields');
  });
});

describe('executeStatusMove — what actually gets sent', () => {
  it('sends exactly one request for the atomic plan, carrying the sub-status', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITH_SUB_STATUS]);

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('applied');
    expect(mockSaveTransition).toHaveBeenCalledTimes(1);
    expect(mockSaveTransition).toHaveBeenCalledWith('DEV-1', '31', { [SUB_STATUS_FIELD]: { value: 'Dev Complete' } });
    expect(mockSaveOptionField).not.toHaveBeenCalled();
  });

  it('sends the transition first and then the field when they cannot be written together', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITHOUT_SUB_STATUS]);

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('applied');
    expect(mockSaveTransition).toHaveBeenCalledTimes(1);
    expect(mockSaveOptionField).toHaveBeenCalledTimes(1);
  });

  it('sends no transition when only the sub-status differs', async () => {
    mockFetchTransitions.mockResolvedValue([]);

    await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'In Progress',
      currentSubStatusValue: 'Dev In Progress',
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(mockSaveTransition).not.toHaveBeenCalled();
    expect(mockSaveOptionField).toHaveBeenCalledTimes(1);
  });

  it('sends nothing at all when the card was dropped where it already was', async () => {
    mockFetchTransitions.mockResolvedValue([]);

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'In Progress',
      currentSubStatusValue: 'Dev Complete',
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('applied');
    expect(mockSaveTransition).not.toHaveBeenCalled();
    expect(mockSaveOptionField).not.toHaveBeenCalled();
  });

  it('writes nothing when the transition is not permitted, and names what Jira refused', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITH_SUB_STATUS]);

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'Accepted', subStatusValue: null },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('refused');
    expect(mockSaveTransition).not.toHaveBeenCalled();
    expect(outcome.message).toContain('Accepted');
  });

  it('writes nothing when required screen fields are unanswered, and says which', async () => {
    mockFetchTransitions.mockResolvedValue([{
      ...TRANSITION_WITHOUT_SUB_STATUS,
      requiredFields: [{ fieldId: 'customfield_20001', name: 'Defect Root Cause', schemaType: 'option', allowedValues: [] }],
    }]);

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: null },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('needs-fields');
    expect(mockSaveTransition).not.toHaveBeenCalled();
    expect(outcome.status === 'needs-fields' && outcome.requiredFields[0].name).toBe('Defect Root Cause');
  });
});

describe('executeStatusMove — failure honesty', () => {
  it('returns the card to where it started when the single atomic write fails as a unit', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITH_SUB_STATUS]);
    mockSaveTransition.mockRejectedValue(new Error('Jira said no'));

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.shouldRevertCard).toBe(true);
    expect(outcome.message).toContain('Jira said no');
  });

  it('does NOT return the card when the status changed but the sub-status write failed', async () => {
    // Jira really did move the issue. Snapping the card back would show a state Jira does not hold,
    // and no error message can undo a board that is drawing a falsehood.
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITHOUT_SUB_STATUS]);
    mockSaveOptionField.mockRejectedValue(new Error('sub-status rejected'));
    mockJiraGet.mockResolvedValue({
      key: 'DEV-1',
      fields: { status: { name: 'In Progress' }, [SUB_STATUS_FIELD]: null },
    });

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('partially-applied');
    expect(outcome.status === 'partially-applied' && outcome.shouldRevertCard).toBe(false);
  });

  it('names exactly what applied and what did not after a partial write', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITHOUT_SUB_STATUS]);
    mockSaveOptionField.mockRejectedValue(new Error('sub-status rejected'));
    mockJiraGet.mockResolvedValue({
      key: 'DEV-1',
      fields: { status: { name: 'In Progress' }, [SUB_STATUS_FIELD]: null },
    });

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.message).toContain('In Progress');
    expect(outcome.message).toContain('Dev Complete');
    expect(outcome.message).toContain('sub-status rejected');
  });

  it('re-reads the issue after a partial write, so the card can settle at the truth', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITHOUT_SUB_STATUS]);
    mockSaveOptionField.mockRejectedValue(new Error('sub-status rejected'));
    mockJiraGet.mockResolvedValue({
      key: 'DEV-1',
      fields: { status: { name: 'In Progress' }, [SUB_STATUS_FIELD]: { value: 'Dev In Progress' } },
    });

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(mockJiraGet).toHaveBeenCalledWith(expect.stringContaining('DEV-1'));
    expect(outcome.status === 'partially-applied' && outcome.actualStatusName).toBe('In Progress');
    expect(outcome.status === 'partially-applied' && outcome.actualSubStatusValue).toBe('Dev In Progress');
  });

  it('still reports the partial write when even the re-read fails, rather than claiming success', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITHOUT_SUB_STATUS]);
    mockSaveOptionField.mockRejectedValue(new Error('sub-status rejected'));
    mockJiraGet.mockRejectedValue(new Error('re-read failed'));

    const outcome = await executeStatusMove({
      issueKey: 'DEV-1',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: TARGET,
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('partially-applied');
    expect(outcome.status === 'partially-applied' && outcome.shouldRevertCard).toBe(false);
  });
});
