// SettingsStep.test.tsx — Proves both addresses can be changed (a new Jira instance arrives soon), a bad one is explained,
// and the relay bookmark is offered for dragging, never for clicking here.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SettingsStep from './SettingsStep.tsx';
import type { SaveAddressResult } from './wizardSettings.ts';

const SNOW_URL = 'https://acme.service-now.com';
const JIRA_URL = 'https://jira.example.com';

function acceptAddress(addressText: string): SaveAddressResult {
  return { isSaved: true, address: addressText };
}

function renderSettings(onSaveSnowUrl = vi.fn(acceptAddress), onSaveJiraUrl = vi.fn(acceptAddress)) {
  const onClose = vi.fn();
  render(<SettingsStep snowUrl={SNOW_URL} jiraUrl={JIRA_URL} appVersion="v9.9.9" onSaveSnowUrl={onSaveSnowUrl} onSaveJiraUrl={onSaveJiraUrl} onClose={onClose} />);
  return { onSaveSnowUrl, onSaveJiraUrl, onClose };
}

describe('SettingsStep', () => {
  it('shows both current addresses and saves a changed Jira address, saying it reconnects', () => {
    const handlers = renderSettings();
    expect((screen.getByLabelText('ServiceNow address') as HTMLInputElement).value).toBe(SNOW_URL);
    const jiraField = screen.getByLabelText('Jira address') as HTMLInputElement;
    expect(jiraField.value).toBe(JIRA_URL);

    fireEvent.change(jiraField, { target: { value: 'https://jira-new.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save addresses' }));

    expect(handlers.onSaveSnowUrl).toHaveBeenCalledWith(SNOW_URL);
    expect(handlers.onSaveJiraUrl).toHaveBeenCalledWith('https://jira-new.example.com');
    const statusText = screen.getByRole('status').textContent;
    expect(statusText).toContain('ServiceNow: saved.');
    expect(statusText).toContain('Jira: saved — reconnecting.');
  });

  it('shows why an address was refused', () => {
    const refuseAddress = vi.fn((): SaveAddressResult => ({ isSaved: false, address: SNOW_URL, problem: 'Enter the full address, starting with https://' }));
    renderSettings(refuseAddress);
    fireEvent.change(screen.getByLabelText('ServiceNow address'), { target: { value: 'acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save addresses' }));
    expect(screen.getByRole('status').textContent).toContain('ServiceNow: Enter the full address, starting with https://');
  });

  it('offers the relay bookmark as a javascript: link that does nothing when clicked here', () => {
    renderSettings();
    const bookmarkLink = screen.getByText('SNow Wizard', { selector: 'a' });
    expect(bookmarkLink.getAttribute('href')).toMatch(/^javascript:/);
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    bookmarkLink.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('shows the version and goes back', () => {
    const handlers = renderSettings();
    expect(screen.getByText('SNow Wizard v9.9.9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
