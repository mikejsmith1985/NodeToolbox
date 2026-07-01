// IntakeConfigPanel.test.tsx — Covers project change notification, issue-type selection, mapping
// edits, the auto-create toggle, and assembling the saved config (only mapped fields included).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IntakeConfigPanel from './IntakeConfigPanel.tsx';
import type { CreateMetaIssueType } from '../../../types/jira.ts';
import type { IntakeConfig } from '../lib/intakeTypes.ts';

const ISSUE_TYPES: CreateMetaIssueType[] = [
  { id: '10001', name: 'Story', subtask: false },
  { id: '10002', name: 'Bug', subtask: false },
];

describe('IntakeConfigPanel', () => {
  it('notifies the parent when the project key changes', () => {
    const onProjectKeyChange = vi.fn();
    render(
      <IntakeConfigPanel
        initialConfig={null}
        artProjectKeys={['ENFCT']}
        issueTypes={[]}
        onProjectKeyChange={onProjectKeyChange}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Target project' }), { target: { value: 'ENFCT' } });
    expect(onProjectKeyChange).toHaveBeenCalledWith('ENFCT');
  });

  it('disables save until a project and issue type are chosen', () => {
    render(
      <IntakeConfigPanel
        initialConfig={null}
        artProjectKeys={[]}
        issueTypes={ISSUE_TYPES}
        onProjectKeyChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
  });

  it('assembles a config with only the mapped core fields and the chosen issue type', () => {
    const onSave = vi.fn();
    render(
      <IntakeConfigPanel
        initialConfig={null}
        artProjectKeys={[]}
        issueTypes={ISSUE_TYPES}
        onProjectKeyChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Target project' }), { target: { value: 'enfct' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Issue type' }), { target: { value: '10002' } });
    fireEvent.click(screen.getByLabelText(/auto-create issues on import/i));
    fireEvent.click(screen.getByRole('button', { name: /save configuration/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedConfig = onSave.mock.calls[0][0] as IntakeConfig;
    expect(savedConfig.projectKey).toBe('ENFCT');
    expect(savedConfig.issueTypeId).toBe('10002');
    expect(savedConfig.issueTypeName).toBe('Bug');
    expect(savedConfig.autoCreateOnImport).toBe(false);
    // acceptanceCriteria + issueType default to blank field ids, so they are not mapped.
    expect(savedConfig.fieldMappings.map((mapping) => mapping.coreField).sort()).toEqual(['description', 'priority', 'summary']);
  });
});
