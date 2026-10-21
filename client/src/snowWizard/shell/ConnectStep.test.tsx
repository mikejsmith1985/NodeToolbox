// ConnectStep.test.tsx — Proves the Connect screen shows each system and walks the user through opening Jira.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectStep from './ConnectStep.tsx';
import type { ConnectionState } from './wizardConnectionStore.ts';

const CONNECTED_SNOW: ConnectionState = { status: 'connected', identity: 'Smith, Jane', detail: '' };
const NOT_CONNECTED: ConnectionState = { status: 'notConnected', identity: '', detail: '' };

describe('ConnectStep', () => {
  it('shows ServiceNow connected and walks the user through opening Jira', () => {
    const onOpenJira = vi.fn();
    render(<ConnectStep snowState={CONNECTED_SNOW} jiraState={NOT_CONNECTED} jiraUrl="https://jira.example.com" onOpenJira={onOpenJira} />);

    expect(screen.getByText(/ServiceNow: connected as Smith, Jane/)).toBeTruthy();
    expect(screen.getByText(/click the SNow Wizard bookmark there/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    expect(onOpenJira).toHaveBeenCalled();
  });

  it('shows the reason when Jira could not connect', () => {
    render(<ConnectStep snowState={CONNECTED_SNOW} jiraState={{ status: 'notConnected', identity: '', detail: 'no hello within 180s' }} jiraUrl="https://jira.example.com" onOpenJira={vi.fn()} />);
    expect(screen.getByText(/no hello within 180s/)).toBeTruthy();
  });
});
