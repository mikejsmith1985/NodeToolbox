// BusinessHelperSettingsTab.test.tsx — Render tests for Business Helper settings and Simple Search mapping controls.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import BusinessHelperSettingsTab from './BusinessHelperSettingsTab.tsx';

describe('BusinessHelperSettingsTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders column settings and mapping controls for the Stablization table', () => {
    render(<BusinessHelperSettingsTab />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Grouping input type')).toBeInTheDocument();
    expect(screen.getByLabelText('Name mapping source')).toBeInTheDocument();
  });

  it('persists dropdown configuration and mapping changes to localStorage', () => {
    render(<BusinessHelperSettingsTab />);

    fireEvent.change(screen.getByLabelText('Name input type'), { target: { value: 'dropdown' } });
    fireEvent.change(screen.getByLabelText('New option for Name'), { target: { value: 'Funding Candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add option to Name' }));
    fireEvent.change(screen.getByLabelText('Name mapping source'), { target: { value: 'summary' } });

    const storedSettings = JSON.parse(window.localStorage.getItem('tbxBusinessHelperSettings') ?? '{}');
    expect(storedSettings.stablizationColumns.name.inputKind).toBe('dropdown');
    expect(storedSettings.stablizationColumns.name.dropdownOptions).toContain('Funding Candidate');
    expect(storedSettings.simpleSearchMapping.name).toBe('summary');
    expect(screen.getByText('Funding Candidate')).toBeInTheDocument();
  });
});
