// StablizationFundingTab.test.tsx — Render tests for the Business Helper stablization funding table.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import StablizationFundingTab from './StablizationFundingTab.tsx';

describe('StablizationFundingTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the stablization header, one default row, and zeroed footer totals', () => {
    render(<StablizationFundingTab />);

    expect(screen.getByRole('heading', { name: 'Stablization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Grouping for row 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Fulfillment Cost footer total')).toHaveTextContent('$0.00');
    expect(screen.getByLabelText('Total footer total')).toHaveTextContent('$0.00');
  });

  it('calculates Testing, Total, and footer totals as the user edits currency fields', () => {
    render(<StablizationFundingTab />);

    fireEvent.change(screen.getByLabelText('Fulfillment Cost for row 1'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Enrollment Cost for row 1'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Billing for row 1'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Cost for row 1'), { target: { value: '10' } });

    expect(screen.getByLabelText('Testing amount for row 1')).toHaveTextContent('$50.00');
    expect(screen.getByLabelText('Total amount for row 1')).toHaveTextContent('$250.00');
    expect(screen.getByLabelText('Testing footer total')).toHaveTextContent('$50.00');
    expect(screen.getByLabelText('Total footer total')).toHaveTextContent('$250.00');
    expect(screen.getByLabelText('Cost footer total')).toHaveTextContent('$10.00');
  });

  it('adds an extra funding row when the user clicks the add button', () => {
    render(<StablizationFundingTab />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add Funding Row' }));

    expect(screen.getByLabelText('Grouping for row 2')).toBeInTheDocument();
  });

  it('renders a dropdown control when the column is configured as a dropdown in settings', () => {
    window.localStorage.setItem(
      'tbxBusinessHelperSettings',
      JSON.stringify({
        stablizationColumns: {
          grouping: { inputKind: 'dropdown', dropdownOptions: ['Portfolio'] },
          name: { inputKind: 'text', dropdownOptions: [] },
          justification: { inputKind: 'text', dropdownOptions: [] },
        },
        simpleSearchMapping: {
          grouping: 'none',
          name: 'jira-key-summary',
          justification: 'none',
        },
      }),
    );

    render(<StablizationFundingTab />);

    expect(screen.getByRole('combobox', { name: 'Grouping for row 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Portfolio' })).toBeInTheDocument();
  });
});
