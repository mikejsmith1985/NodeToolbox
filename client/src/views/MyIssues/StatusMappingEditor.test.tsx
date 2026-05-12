// StatusMappingEditor.test.tsx — Tests for the StatusMappingEditor component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusMappingEditor } from './StatusMappingEditor.tsx';
import type { StatusMapping } from '../../types/issueLinking.ts';

// ── Mock settingsStore ──

const mockSetStatusMappings = vi.fn();
let mockStatusMappings: StatusMapping[] = [];

vi.mock('../../store/settingsStore.ts', () => ({
  useSettingsStore: () => ({
    statusMappings: mockStatusMappings,
    setStatusMappings: mockSetStatusMappings,
  }),
}));

// ── Tests ──

describe('StatusMappingEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusMappings = [];
  });

  it('renders the section title', () => {
    render(<StatusMappingEditor />);
    expect(screen.getByText(/Jira → ServiceNow Status Mapping/i)).toBeInTheDocument();
  });

  it('always shows the system-defined To Do → New row', () => {
    render(<StatusMappingEditor />);
    // The system row has two disabled inputs with these values.
    const inputs = screen.getAllByRole('textbox');
    const systemInputValues = inputs.map((input) => (input as HTMLInputElement).value);
    expect(systemInputValues).toContain('To Do');
    expect(systemInputValues).toContain('New');
  });

  it('renders user-defined mappings from the store', () => {
    mockStatusMappings = [
      { jiraStatus: 'In Progress', snowStatus: 'In Progress', isSystemDefined: false },
    ];
    render(<StatusMappingEditor />);
    const inputs = screen.getAllByRole('textbox');
    const inputValues = inputs.map((i) => (i as HTMLInputElement).value);
    expect(inputValues).toContain('In Progress');
  });

  it('shows a remove button for each user-defined mapping', () => {
    mockStatusMappings = [
      { jiraStatus: 'In Progress', snowStatus: 'In Progress', isSystemDefined: false },
    ];
    render(<StatusMappingEditor />);
    expect(screen.getByRole('button', { name: /Remove mapping for In Progress/i })).toBeInTheDocument();
  });

  it('does not show a remove button for the system mapping', () => {
    render(<StatusMappingEditor />);
    expect(screen.queryByRole('button', { name: /Remove mapping for To Do/i })).not.toBeInTheDocument();
  });

  it('calls setStatusMappings when a user removes a mapping', async () => {
    mockStatusMappings = [
      { jiraStatus: 'Done', snowStatus: 'Resolved', isSystemDefined: false },
    ];
    const user = userEvent.setup();
    render(<StatusMappingEditor />);

    await user.click(screen.getByRole('button', { name: /Remove mapping for Done/i }));

    expect(mockSetStatusMappings).toHaveBeenCalledOnce();
    const updatedMappings: StatusMapping[] = mockSetStatusMappings.mock.calls[0][0] as StatusMapping[];
    expect(updatedMappings.find((m) => m.jiraStatus === 'Done')).toBeUndefined();
  });

  it('disables the Add button when both inputs are empty', () => {
    render(<StatusMappingEditor />);
    expect(screen.getByRole('button', { name: /Add status mapping/i })).toBeDisabled();
  });

  it('enables the Add button when both inputs have text', async () => {
    const user = userEvent.setup();
    render(<StatusMappingEditor />);

    await user.type(screen.getByRole('textbox', { name: /New Jira status/i }), 'Blocked');
    await user.type(screen.getByRole('textbox', { name: /New SNow state/i }), 'On Hold');

    expect(screen.getByRole('button', { name: /Add status mapping/i })).toBeEnabled();
  });

  it('calls setStatusMappings with the new mapping when Add is clicked', async () => {
    const user = userEvent.setup();
    render(<StatusMappingEditor />);

    await user.type(screen.getByRole('textbox', { name: /New Jira status/i }), 'Blocked');
    await user.type(screen.getByRole('textbox', { name: /New SNow state/i }), 'On Hold');
    await user.click(screen.getByRole('button', { name: /Add status mapping/i }));

    expect(mockSetStatusMappings).toHaveBeenCalledOnce();
    const savedMappings: StatusMapping[] = mockSetStatusMappings.mock.calls[0][0] as StatusMapping[];
    expect(savedMappings.find((m) => m.jiraStatus === 'Blocked')).toBeDefined();
  });

  it('clears the input fields after adding a mapping', async () => {
    const user = userEvent.setup();
    render(<StatusMappingEditor />);

    const jiraInput = screen.getByRole('textbox', { name: /New Jira status/i });
    const snowInput = screen.getByRole('textbox', { name: /New SNow state/i });

    await user.type(jiraInput, 'Done');
    await user.type(snowInput, 'Resolved');
    await user.click(screen.getByRole('button', { name: /Add status mapping/i }));

    expect((jiraInput as HTMLInputElement).value).toBe('');
    expect((snowInput as HTMLInputElement).value).toBe('');
  });

  it('shows the persistence note', () => {
    render(<StatusMappingEditor />);
    expect(screen.getAllByText(/Mappings are saved automatically/i).length).toBeGreaterThan(0);
  });
});
