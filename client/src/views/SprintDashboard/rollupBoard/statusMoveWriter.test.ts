// statusMoveWriter.test.ts — Proves a card move either happens properly or is reported properly.
//
// The case worth reading first is the two-step partial failure. When Jira will not let the status
// and the sub-status be written together, the status change can succeed while the sub-status write
// fails. Snapping the card back would then draw a state Jira does not hold — the board would be
// lying, which is the one thing this whole feature exists to stop. So it settles at the truth and
// says exactly what did and did not apply.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchTransitions, mockSaveTransition, mockFetchEditMeta, mockJiraGet, mockJiraPut } = vi.hoisted(() => ({
  mockFetchTransitions: vi.fn(),
  mockSaveTransition: vi.fn(),
  mockFetchEditMeta: vi.fn(),
  mockJiraGet: vi.fn(),
  mockJiraPut: vi.fn(),
}));

vi.mock('../featureReviewFixes.ts', () => ({
  fetchFeatureReviewTransitions: mockFetchTransitions,
  saveFeatureReviewTransition: mockSaveTransition,
  saveFeatureReviewOptionField: vi.fn(),
  fetchFeatureReviewEditMeta: mockFetchEditMeta,
  isTransitionFieldSupported: (field: { schemaType: string }) =>
    ['option', 'option-with-child', 'string'].includes(field.schemaType),
  areTransitionSelectionsComplete: () => true,
  buildTransitionFieldsPayload: () => ({}),
}));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet, jiraPut: mockJiraPut }));

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

/** The sub-status field as this instance defines it, which is what the writer now resolves against. */
const SUB_STATUS_EDIT_META = {
  [SUB_STATUS_FIELD]: {
    name: 'Sub-Status',
    allowedValues: [
      { id: '10', value: 'Dev In Progress' },
      { id: '11', value: 'Dev Complete' },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveTransition.mockResolvedValue(undefined);
  mockFetchEditMeta.mockResolvedValue(SUB_STATUS_EDIT_META);
  mockJiraPut.mockResolvedValue(undefined);
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
    // Resolved to the option's ID, which survives an admin renaming the label.
    expect(mockSaveTransition).toHaveBeenCalledWith('DEV-1', '31', { [SUB_STATUS_FIELD]: { id: '11' } });
    expect(mockJiraPut).not.toHaveBeenCalled();
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
    expect(mockJiraPut).toHaveBeenCalledTimes(1);
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
    expect(mockJiraPut).toHaveBeenCalledTimes(1);
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
    expect(mockJiraPut).not.toHaveBeenCalled();
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
    mockJiraPut.mockRejectedValue(new Error('sub-status rejected'));
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
    mockJiraPut.mockRejectedValue(new Error('sub-status rejected'));
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
    mockJiraPut.mockRejectedValue(new Error('sub-status rejected'));
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
    mockJiraPut.mockRejectedValue(new Error('sub-status rejected'));
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

// ── Clearing the sub-status ──
//
// The bug this covers, from the board: a card reading "Working / New" sat in Unmapped because no
// column claims that pair. Dragging it to the Working column — which claims the STATUS on its own —
// was refused with "the workflow has no step from Working to this column", because the status was
// already Working and the planner went looking for a transition instead of emptying the sub-status.
describe('planStatusMove — a column that claims the status on its own', () => {
  it('empties the sub-status instead of hunting for a transition that cannot exist', () => {
    const plan = planStatusMove({
      currentStatusName: 'Working',
      currentSubStatusValue: 'New',
      targetMapping: { jiraStatusName: 'Working', subStatusValue: null },
      transitions: [],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('field-only');
    expect(plan.kind === 'field-only' && plan.subStatusValue).toBeNull();
  });

  it('transitions AND empties the sub-status when the status differs too', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: 'New',
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: null },
      transitions: [TRANSITION_WITHOUT_SUB_STATUS],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('transition-then-field');
    expect(plan.kind === 'transition-then-field' && plan.subStatusValue).toBeNull();
  });

  it('still transitions alone when there is no sub-status to clear', () => {
    const plan = planStatusMove({
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: null },
      transitions: [TRANSITION_WITHOUT_SUB_STATUS],
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(plan.kind).toBe('transition-only');
  });

  it('never touches a sub-status field this instance does not have', () => {
    const plan = planStatusMove({
      currentStatusName: 'Working',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'Working', subStatusValue: null },
      transitions: [],
      subStatusFieldId: '',
    });

    expect(plan.kind).toBe('no-op');
  });
});

describe('executeStatusMove — clearing writes an empty value, not an empty string', () => {
  beforeEach(() => {
    mockJiraPut.mockReset();
    mockJiraPut.mockResolvedValue(undefined);
    mockSaveTransition.mockReset();
    mockFetchTransitions.mockReset();
  });

  it('sends null for the field rather than resolving an option that does not exist', async () => {
    mockFetchTransitions.mockResolvedValue([]);

    const outcome = await executeStatusMove({
      issueKey: 'ENFCT-2019',
      currentStatusName: 'Working',
      currentSubStatusValue: 'New',
      targetMapping: { jiraStatusName: 'Working', subStatusValue: null },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('applied');
    // No allowed value means "none", so clearing is an empty write rather than a resolved option —
    // and it needs no edit-metadata read at all.
    expect(mockFetchEditMeta).not.toHaveBeenCalled();
    expect(mockJiraPut).toHaveBeenCalledWith(
      '/rest/api/2/issue/ENFCT-2019',
      { fields: { [SUB_STATUS_FIELD]: null } },
    );
  });

  it('clears the sub-status in the same request when the transition screen carries it', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITH_SUB_STATUS]);
    mockSaveTransition.mockResolvedValue(undefined);

    await executeStatusMove({
      issueKey: 'ENFCT-2019',
      currentStatusName: 'To Do',
      currentSubStatusValue: 'New',
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: null },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(mockSaveTransition).toHaveBeenCalledWith('ENFCT-2019', '31', { [SUB_STATUS_FIELD]: null });
  });
});

// ── The cascading sub-status field ──
//
// The exact failure from the board: dragging ENCUC-2201 to SL Testing produced
// `400 — Could not find valid 'id' or 'value' in the Parent Option object`, because the board sent
// `{ value: "Testing" }` at a field whose "Testing" is a CHILD of "Ready for Testing". The same
// change made by hand in Jira worked, which is what proved the write and not the mapping was wrong.
describe('executeStatusMove — a cascading sub-status field', () => {
  const CASCADING_EDIT_META = {
    [SUB_STATUS_FIELD]: {
      name: 'Sub-Status',
      allowedValues: [
        { id: '200', value: 'Ready for Testing', children: [{ id: '201', value: 'Testing' }] },
      ],
    },
  };

  beforeEach(() => {
    mockFetchEditMeta.mockResolvedValue(CASCADING_EDIT_META);
    mockJiraPut.mockResolvedValue(undefined);
  });

  it('sends the parent alongside the child instead of the child alone', async () => {
    mockFetchTransitions.mockResolvedValue([]);

    const outcome = await executeStatusMove({
      issueKey: 'ENCUC-2201',
      currentStatusName: 'Ready for Testing',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'Ready for Testing', subStatusValue: 'Testing' },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('applied');
    expect(mockJiraPut).toHaveBeenCalledWith(
      '/rest/api/2/issue/ENCUC-2201',
      { fields: { [SUB_STATUS_FIELD]: { id: '200', child: { id: '201' } } } },
    );
  });

  it('writes nothing at all when the mapping names an option the field does not have', async () => {
    mockFetchTransitions.mockResolvedValue([]);

    const outcome = await executeStatusMove({
      issueKey: 'ENCUC-2201',
      currentStatusName: 'Ready for Testing',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'Ready for Testing', subStatusValue: 'Testng' },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('Ready for Testing / Testing');
    expect(mockJiraPut).not.toHaveBeenCalled();
  });

  it('refuses BEFORE transitioning, so an unwritable mapping cannot half-move the issue', async () => {
    mockFetchTransitions.mockResolvedValue([TRANSITION_WITHOUT_SUB_STATUS]);

    const outcome = await executeStatusMove({
      issueKey: 'ENCUC-2201',
      currentStatusName: 'To Do',
      currentSubStatusValue: null,
      targetMapping: { jiraStatusName: 'In Progress', subStatusValue: 'Testng' },
      subStatusFieldId: SUB_STATUS_FIELD,
    });

    expect(outcome.status).toBe('failed');
    // The status change is the part that cannot be undone, so it must not be attempted first.
    expect(mockSaveTransition).not.toHaveBeenCalled();
  });
});
