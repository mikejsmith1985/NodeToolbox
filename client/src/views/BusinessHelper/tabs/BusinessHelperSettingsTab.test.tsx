// BusinessHelperSettingsTab.test.tsx — Render tests for Business Helper settings and Simple Search mapping controls.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import BusinessHelperSettingsTab from './BusinessHelperSettingsTab.tsx';

describe('BusinessHelperSettingsTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders built-in settings and custom column controls for the Stablization table', () => {
    render(<BusinessHelperSettingsTab />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Grouping input type')).toBeInTheDocument();
    expect(screen.getByLabelText('Name mapping source')).toBeInTheDocument();
    expect(screen.getByLabelText('New custom column label')).toBeInTheDocument();
  });

  it('persists a new custom column and its configuration to localStorage', () => {
    render(<BusinessHelperSettingsTab />);

    fireEvent.change(screen.getByLabelText('New custom column label'), { target: { value: 'Owner Notes' } });
    fireEvent.change(screen.getByLabelText('New custom column data type'), { target: { value: 'dropdown' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add custom column' }));

    fireEvent.change(screen.getByLabelText('Owner Notes mapping source'), { target: { value: 'summary' } });
    fireEvent.change(screen.getByLabelText('New option for Owner Notes'), { target: { value: 'Needs follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option to Owner Notes' }));

    const storedSettings = JSON.parse(window.localStorage.getItem('tbxBusinessHelperSettings') ?? '{}');
    expect(storedSettings.stablizationUserColumns).toHaveLength(1);
    expect(storedSettings.stablizationUserColumns[0]).toMatchObject({
      label: 'Owner Notes',
      dataType: 'dropdown',
      simpleSearchMapping: 'summary',
      dropdownOptions: ['Needs follow-up'],
    });
    expect(screen.getByText('Needs follow-up')).toBeInTheDocument();
  });
});
