// SettingsStep.test.tsx — Proves the Jira address can be changed (a new Jira instance arrives soon) and a bad one is explained.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SettingsStep from './SettingsStep.tsx';

describe('SettingsStep', () => {
  it('shows the current Jira address and saves a new one', () => {
    const onSaveJiraUrl = vi.fn(() => ({ isSaved: true, jiraUrl: 'https://jira-new.example.com' }));
    render(<SettingsStep jiraUrl="https://jira.example.com" onSaveJiraUrl={onSaveJiraUrl} onClose={vi.fn()} />);

    const jiraField = screen.getByLabelText('Jira address') as HTMLInputElement;
    expect(jiraField.value).toBe('https://jira.example.com');
    fireEvent.change(jiraField, { target: { value: 'https://jira-new.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and reconnect Jira' }));

    expect(onSaveJiraUrl).toHaveBeenCalledWith('https://jira-new.example.com');
    expect(screen.getByText(/Saved/)).toBeTruthy();
  });

  it('shows why an address was refused', () => {
    const onSaveJiraUrl = vi.fn(() => ({ isSaved: false, jiraUrl: 'https://jira.example.com', problem: 'Enter the full Jira address, starting with https://' }));
    render(<SettingsStep jiraUrl="https://jira.example.com" onSaveJiraUrl={onSaveJiraUrl} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save and reconnect Jira' }));
    expect(screen.getByText(/starting with https:\/\//)).toBeTruthy();
  });
});
