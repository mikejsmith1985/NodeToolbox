// index.test.tsx — Unit tests for the shared transition required-fields inputs.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TransitionRequiredFields } from './index.tsx';

const OPTION_FIELD = {
  fieldId: 'cfRootCause',
  name: 'Defect Root Cause',
  schemaType: 'option',
  allowedValues: [{ id: '900', value: 'Code' }, { id: '901', value: 'Config' }],
};

const CASCADING_FIELD = {
  fieldId: 'cfComponent',
  name: 'Application Component Selection',
  schemaType: 'option-with-child',
  allowedValues: [{ id: '800', value: 'Facets', children: [{ id: '810', value: 'Eligibility' }] }],
};

describe('TransitionRequiredFields', () => {
  it('renders nothing when the transition requires no fields', () => {
    const { container } = render(
      <TransitionRequiredFields requiredFields={[]} selectionByFieldId={{}} onSelectionChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a labelled dropdown per option field and reports the chosen option id', () => {
    const handleSelectionChange = vi.fn();
    render(
      <TransitionRequiredFields
        requiredFields={[OPTION_FIELD]}
        selectionByFieldId={{}}
        onSelectionChange={handleSelectionChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Defect Root Cause'), { target: { value: '900' } });

    expect(handleSelectionChange).toHaveBeenCalledWith('cfRootCause', { optionId: '900' });
  });

  it('shows the child dropdown of a cascading field once its parent is chosen', () => {
    const handleSelectionChange = vi.fn();
    render(
      <TransitionRequiredFields
        requiredFields={[CASCADING_FIELD]}
        selectionByFieldId={{ cfComponent: { optionId: '800' } }}
        onSelectionChange={handleSelectionChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Application Component Selection — detail'), { target: { value: '810' } });

    expect(handleSelectionChange).toHaveBeenCalledWith('cfComponent', { optionId: '800', childOptionId: '810' });
  });

  it('renders a text input for string fields', () => {
    const handleSelectionChange = vi.fn();
    render(
      <TransitionRequiredFields
        requiredFields={[{ fieldId: 'cfReason', name: 'Reason', schemaType: 'string', allowedValues: [] }]}
        selectionByFieldId={{}}
        onSelectionChange={handleSelectionChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'root cause found' } });

    expect(handleSelectionChange).toHaveBeenCalledWith('cfReason', { text: 'root cause found' });
  });

  it('states plainly when a required field cannot be edited here', () => {
    render(
      <TransitionRequiredFields
        requiredFields={[{ fieldId: 'cfUser', name: 'Approver', schemaType: 'user', allowedValues: [] }]}
        selectionByFieldId={{}}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/“Approver” must be completed in Jira/)).toBeInTheDocument();
  });
});
