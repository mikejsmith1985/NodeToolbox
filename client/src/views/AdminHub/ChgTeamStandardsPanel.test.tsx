// ChgTeamStandardsPanel.test.tsx — Editing the team's standing answers to the CHG risk check in Admin Hub.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TEAM_STANDARDS, readTeamStandards } from '../SnowHub/chgFormula/teamStandardsStore.ts';
import { ChgTeamStandardsPanel } from './ChgTeamStandardsPanel.tsx';

describe('ChgTeamStandardsPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the current standing answers, one row each', () => {
    render(<ChgTeamStandardsPanel />);

    expect(screen.getAllByRole('combobox', { name: /Formula Card field/ })).toHaveLength(DEFAULT_TEAM_STANDARDS.length);
    expect(screen.getByDisplayValue(DEFAULT_TEAM_STANDARDS[2].answer)).toBeInTheDocument();
  });

  it('saves an edited answer, which the risk check then uses', () => {
    render(<ChgTeamStandardsPanel />);

    fireEvent.change(screen.getByDisplayValue(DEFAULT_TEAM_STANDARDS[2].answer), { target: { value: 'Start with the on-call lead.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save standards' }));

    expect(readTeamStandards()[2]).toEqual({ fieldName: 'Escalation Path', answer: 'Start with the on-call lead.' });
    expect(screen.getByText(/Saved — the next risk check uses them/)).toBeInTheDocument();
  });

  it('adds a standard for a field picked from the Formula Card, and removes one', () => {
    render(<ChgTeamStandardsPanel />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add standard' }));
    const fieldPickers = screen.getAllByRole('combobox', { name: /Formula Card field/ });
    const newRowPicker = fieldPickers[fieldPickers.length - 1];
    expect(within(newRowPicker).getByRole('option', { name: 'Business Validation' })).toBeInTheDocument();
    expect(within(newRowPicker).queryByRole('option', { name: 'Implementation Duration' })).not.toBeInTheDocument();
    fireEvent.change(newRowPicker, { target: { value: 'Business Validation' } });
    fireEvent.change(screen.getAllByRole('textbox', { name: /Standing answer/ }).at(-1)!, { target: { value: 'The PO validates.' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save standards' }));

    expect(readTeamStandards().map((standard) => standard.fieldName))
      .toEqual(['Test Results', 'Escalation Path', 'Business Validation']);
  });

  it('goes back to the defaults on Reset', () => {
    render(<ChgTeamStandardsPanel />);

    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save standards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(readTeamStandards()).toEqual(DEFAULT_TEAM_STANDARDS);
    expect(screen.getAllByRole('combobox', { name: /Formula Card field/ })).toHaveLength(DEFAULT_TEAM_STANDARDS.length);
  });
});
