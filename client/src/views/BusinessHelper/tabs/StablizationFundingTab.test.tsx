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

  it('selects the only configured dropdown value automatically for new blank rows', () => {
    window.localStorage.setItem(
      'tbxBusinessHelperSettings',
      JSON.stringify({
        stablizationColumns: {
          grouping: { inputKind: 'dropdown', dropdownOptions: ['Portfolio'] },
          name: { inputKind: 'text', dropdownOptions: [] },
          justification: { inputKind: 'dropdown', dropdownOptions: ['Operational Need'] },
        },
        simpleSearchMapping: {
          grouping: 'none',
          name: 'jira-key-summary',
          justification: 'none',
        },
      }),
    );

    render(<StablizationFundingTab />);

    expect(screen.getByRole('combobox', { name: 'Grouping for row 1' })).toHaveValue('Portfolio');
    expect(screen.getByRole('combobox', { name: 'Justification for row 1' })).toHaveValue('Operational Need');
  });

  it('renders a source Jira hyperlink beneath mapped table values', () => {
    window.localStorage.setItem(
      'tbxBusinessHelperStablizationTable',
      JSON.stringify([
        {
          id: 'row-1',
          grouping: 'Portfolio',
          name: 'TBX-101 - Business summary match',
          fulfillmentCost: '',
          enrollmentCost: '',
          billing: '',
          justification: '',
          timing: '',
          cost: '',
          sourceJiraBrowseUrl: 'https://jira.example.com/browse/TBX-101',
          sourceJiraIssueKey: 'TBX-101',
          sourceJiraLinkedColumns: ['name'],
        },
      ]),
    );

    render(<StablizationFundingTab />);

    expect(screen.getByRole('link', { name: 'Open source Jira issue TBX-101' })).toHaveAttribute(
      'href',
      'https://jira.example.com/browse/TBX-101',
    );
  });

  it('renders and totals a user-defined currency column', () => {
    window.localStorage.setItem(
      'tbxBusinessHelperSettings',
      JSON.stringify({
        stablizationColumns: {
          grouping: { inputKind: 'text', dropdownOptions: [] },
          name: { inputKind: 'text', dropdownOptions: [] },
          justification: { inputKind: 'text', dropdownOptions: [] },
        },
        simpleSearchMapping: {
          grouping: 'none',
          name: 'jira-key-summary',
          justification: 'none',
        },
        stablizationUserColumns: [
          {
            id: 'owner-cost',
            label: 'Owner Cost',
            dataType: 'currency',
            dropdownOptions: [],
            widthPx: 180,
            simpleSearchMapping: 'none',
          },
        ],
      }),
    );

    render(<StablizationFundingTab />);

    fireEvent.change(screen.getByLabelText('Owner Cost for row 1'), { target: { value: '75' } });

    expect(screen.getByLabelText('Owner Cost footer total')).toHaveTextContent('$75.00');
  });

  it('persists a resized Name column width from the header handle', () => {
    render(<StablizationFundingTab />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize Name column' }), {
      clientX: 280,
    });
    fireEvent.mouseMove(window, { clientX: 360 });
    fireEvent.mouseUp(window);

    const storedSettings = JSON.parse(window.localStorage.getItem('tbxBusinessHelperSettings') ?? '{}');
    expect(storedSettings.stablizationColumnWidths.name).toBeGreaterThan(280);
  });

  it('keeps resizing across multiple mousemove events instead of stopping after the first drag step', () => {
    render(<StablizationFundingTab />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize Name column' }), {
      clientX: 280,
    });
    fireEvent.mouseMove(window, { clientX: 320 });
    fireEvent.mouseMove(window, { clientX: 420 });
    fireEvent.mouseUp(window);

    const storedSettings = JSON.parse(window.localStorage.getItem('tbxBusinessHelperSettings') ?? '{}');
    expect(storedSettings.stablizationColumnWidths.name).toBe(420);
  });

  it('caps resized column widths at the supported maximum', () => {
    render(<StablizationFundingTab />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize Name column' }), {
      clientX: 280,
    });
    fireEvent.mouseMove(window, { clientX: 900 });
    fireEvent.mouseUp(window);

    const storedSettings = JSON.parse(window.localStorage.getItem('tbxBusinessHelperSettings') ?? '{}');
    expect(storedSettings.stablizationColumnWidths.name).toBe(520);
  });

  it('grows the table width when a column is widened so the user sees a real resize change', () => {
    render(<StablizationFundingTab />);

    const fundingTableElement = screen.getByRole('table');
    const startingTableWidth = fundingTableElement.style.width;

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize Name column' }), {
      clientX: 280,
    });
    fireEvent.mouseMove(window, { clientX: 420 });
    fireEvent.mouseUp(window);

    expect(fundingTableElement.style.width).not.toBe(startingTableWidth);
    expect(fundingTableElement.style.width).toBe('1892px');
  });
});
