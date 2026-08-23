// PlanningDateFields.test.tsx — Editing an issue's timeline on the page that flagged it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSaveSimpleField } = vi.hoisted(() => ({ mockSaveSimpleField: vi.fn() }));

vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: mockSaveSimpleField,
}));

import { PlanningDateFields } from './PlanningDateFields.tsx';
import { resolveHygieneFieldConfig, type JiraIssue } from './checks/hygieneChecks.ts';

const FIELD_CONFIG = resolveHygieneFieldConfig();
const TARGET_START_FIELD = FIELD_CONFIG.targetStartFieldIds[0];

function issueWithDates(fields: Record<string, unknown> = {}): JiraIssue {
  return { key: 'TBX-1', fields: { summary: 'A story', ...fields } } as unknown as JiraIssue;
}

function renderFields(issue: JiraIssue, onDateSaved = vi.fn(), fieldConfig = FIELD_CONFIG) {
  render(<PlanningDateFields fieldConfig={fieldConfig} issue={issue} onDateSaved={onDateSaved} />);
  return onDateSaved;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveSimpleField.mockResolvedValue(undefined);
});

describe('PlanningDateFields', () => {
  it('shows all three planning dates, not just the due date', () => {
    // Every date flag on this page is about one of these three, and the card showed one — so judging
    // a flagged date meant opening the issue in Jira.
    renderFields(issueWithDates());

    expect(screen.getByLabelText('Target Start for TBX-1')).toBeTruthy();
    expect(screen.getByLabelText('Due for TBX-1')).toBeTruthy();
    expect(screen.getByLabelText('Target End for TBX-1')).toBeTruthy();
  });

  it('shows each stored date as the day written on its face', () => {
    const dateInput = () => screen.getByLabelText('Due for TBX-1') as HTMLInputElement;
    renderFields(issueWithDates({ duedate: '2026-09-10T00:00:00.000+0000' }));

    expect(dateInput().value).toBe('2026-09-10');
  });

  it('writes an edited date through the shared field writer', async () => {
    const onDateSaved = renderFields(issueWithDates());

    fireEvent.change(screen.getByLabelText('Target Start for TBX-1'), { target: { value: '2026-08-03' } });
    fireEvent.blur(screen.getByLabelText('Target Start for TBX-1'), { target: { value: '2026-08-03' } });

    await waitFor(() => expect(mockSaveSimpleField).toHaveBeenCalledWith('TBX-1', TARGET_START_FIELD, '2026-08-03'));
    await waitFor(() => expect(onDateSaved).toHaveBeenCalledWith('TBX-1'));
  });

  it('writes nothing when the value has not actually changed', async () => {
    // Tabbing across a card must not put three no-op writes into somebody's Jira history.
    renderFields(issueWithDates({ duedate: '2026-09-10' }));

    fireEvent.blur(screen.getByLabelText('Due for TBX-1'), { target: { value: '2026-09-10' } });

    await waitFor(() => expect(mockSaveSimpleField).not.toHaveBeenCalled());
  });

  it('reports a failed write instead of looking saved', async () => {
    mockSaveSimpleField.mockRejectedValue(new Error('Field is not on the screen'));
    const onDateSaved = renderFields(issueWithDates());

    fireEvent.change(screen.getByLabelText('Due for TBX-1'), { target: { value: '2026-09-11' } });
    fireEvent.blur(screen.getByLabelText('Due for TBX-1'), { target: { value: '2026-09-11' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Field is not on the screen');
    expect(onDateSaved).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the write fails', async () => {
    // Reverting would throw away the value somebody meant to write, at the moment they most need to
    // see it — the field is the only record of it.
    mockSaveSimpleField.mockRejectedValue(new Error('nope'));
    renderFields(issueWithDates());

    const dueInput = screen.getByLabelText('Due for TBX-1') as HTMLInputElement;
    fireEvent.change(dueInput, { target: { value: '2026-09-11' } });
    fireEvent.blur(dueInput, { target: { value: '2026-09-11' } });

    await screen.findByRole('alert');
    expect(dueInput.value).toBe('2026-09-11');
  });

  it('says a date is not configured rather than showing an input that cannot save', () => {
    renderFields(issueWithDates(), vi.fn(), { ...FIELD_CONFIG, targetStartFieldIds: [] });

    expect(screen.queryByLabelText('Target Start for TBX-1')).toBeNull();
    expect(screen.getByText('not configured')).toBeTruthy();
  });
});
