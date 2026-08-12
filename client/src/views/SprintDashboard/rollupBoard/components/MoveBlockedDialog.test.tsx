// MoveBlockedDialog.test.tsx — Proves a refused move is explained in plain words, arrives with the
// fix attached where one is possible, and never offers a form that could not work.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MoveBlockedDialog } from './MoveBlockedDialog.tsx';
import type { MoveBlockDiagnosis } from '../moveBlockDiagnosis.ts';
import type { TransitionRequiredField } from '../../featureReviewFixes.ts';

const STORY_POINTS_FIELD: TransitionRequiredField = {
  fieldId: 'customfield_10002',
  name: 'Story Points',
  schemaType: 'option',
  allowedValues: [{ id: '1', value: '3' }, { id: '2', value: '5' }],
};

const FIELDS_MISSING: MoveBlockDiagnosis = {
  kind: 'fields-required-after-attempt',
  headline: 'DENP-1288 could not move to “Ready for QA”',
  explanation: 'Jira rejected the move because Story Points is missing on DENP-1288.',
  whatToDo: ['Fill in the fields below and the move will be retried automatically.'],
  requiredFieldNames: ['Story Points'],
};

const DEAD_END: MoveBlockDiagnosis = {
  kind: 'no-such-transition',
  headline: 'DENP-1288 could not move to “Done”',
  explanation: 'The workflow has no step from “In Progress” to this column.',
  whatToDo: ['From “In Progress” this issue can only go to Ready for QA.'],
  requiredFieldNames: [],
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof MoveBlockedDialog>> = {}) {
  const calls = { submits: 0, opens: 0, dismisses: 0 };
  render(
    <MoveBlockedDialog
      canSubmit
      diagnosis={FIELDS_MISSING}
      fixableFields={[STORY_POINTS_FIELD]}
      isSaving={false}
      onDismiss={() => { calls.dismisses += 1; }}
      onOpenIssue={() => { calls.opens += 1; }}
      onSelectionChange={() => {}}
      onSubmit={() => { calls.submits += 1; }}
      selectionByFieldId={{}}
      {...overrides}
    />,
  );
  return calls;
}

describe('MoveBlockedDialog', () => {
  it('says what went wrong in words the person who dragged the card would use', () => {
    renderDialog();

    expect(screen.getByText(/could not move to/)).toBeTruthy();
    expect(screen.getByText(/Story Points is missing/)).toBeTruthy();
  });

  it('puts the missing field right in the message, so the fix costs no trip to Jira', () => {
    renderDialog();

    expect(screen.getByLabelText('Story Points')).toBeTruthy();
  });

  it('offers to save and retry once the field has an answer', () => {
    const calls = renderDialog();

    fireEvent.click(screen.getByText('Save and move the card'));

    expect(calls.submits).toBe(1);
  });

  it('waits for an answer before letting the move be retried', () => {
    renderDialog({ canSubmit: false });

    expect(screen.getByText('Save and move the card').hasAttribute('disabled')).toBe(true);
  });

  it('offers no form for a refusal no field could fix', () => {
    renderDialog({ diagnosis: DEAD_END, fixableFields: [] });

    expect(screen.queryByText('Save and move the card')).toBeNull();
    expect(screen.getByText(/can only go to Ready for QA/)).toBeTruthy();
  });

  it('says which fields have to be set in Jira when the board cannot render them', () => {
    renderDialog({ diagnosis: FIELDS_MISSING, fixableFields: [] });

    expect(screen.getByText(/cannot be edited from the board/)).toBeTruthy();
  });

  it('can open the issue instead, for a fix that needs more than one field', () => {
    const calls = renderDialog();

    fireEvent.click(screen.getByText('Open the issue here'));

    expect(calls.opens).toBe(1);
  });

  it('lets the move be abandoned, leaving the card where it was', () => {
    const calls = renderDialog();

    fireEvent.click(screen.getByText('Leave it where it is'));

    expect(calls.dismisses).toBe(1);
  });
});
