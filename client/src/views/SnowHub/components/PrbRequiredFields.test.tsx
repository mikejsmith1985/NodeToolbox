// PrbRequiredFields.test.tsx — The fields Jira's create screen demands, collected before anything is posted.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PrbRequiredFields } from './PrbRequiredFields.tsx';

const ROOT_CAUSE_FIELD = {
  fieldId: 'customfield_10001',
  name: 'Defect Root Cause',
  schemaType: 'option',
  allowedValues: [{ id: '10', value: 'Code' }, { id: '11', value: 'Data' }],
};

const TEAM_FIELD = {
  fieldId: 'customfield_10002',
  name: 'Team',
  schemaType: 'option',
  allowedValues: [{ id: '20', value: 'Cleanup Crew' }],
};

describe('PrbRequiredFields', () => {
  it('renders nothing when no issue type needs anything more', () => {
    const { container } = render(
      <PrbRequiredFields requiredFieldsByIssueType={{ Defect: [], 'Sub-task': [] }} selectionByFieldId={{}} onSelectionChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('says which issue type needs which field, and offers a picker for each', () => {
    // GH #384: the Defect create screen required a field the generator never asked for, so the
    // POST failed with "This field is required" and nothing on screen said what to do.
    render(
      <PrbRequiredFields
        requiredFieldsByIssueType={{ Defect: [ROOT_CAUSE_FIELD, TEAM_FIELD], 'Sub-task': [TEAM_FIELD] }}
        selectionByFieldId={{}}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Defect needs: Defect Root Cause, Team/)).toBeInTheDocument();
    expect(screen.getByText(/Sub-task needs: Team/)).toBeInTheDocument();
    expect(screen.getByLabelText('Defect Root Cause')).toBeInTheDocument();
    // A field two issue types share is asked ONCE — one answer serves both.
    expect(screen.getAllByLabelText('Team')).toHaveLength(1);
  });

  it('reports a choice by field id so the hook can carry it into the create payload', () => {
    const onSelectionChange = vi.fn();
    render(
      <PrbRequiredFields
        requiredFieldsByIssueType={{ Defect: [ROOT_CAUSE_FIELD] }}
        selectionByFieldId={{}}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Defect Root Cause'), { target: { value: '11' } });

    expect(onSelectionChange).toHaveBeenCalledWith('customfield_10001', { optionId: '11' });
  });
});
