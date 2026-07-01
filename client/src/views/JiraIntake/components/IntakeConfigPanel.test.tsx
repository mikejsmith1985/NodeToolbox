// IntakeConfigPanel.test.tsx — Covers the AC field default, save-disabled-until-project, and
// assembling the saved config from the minimal inputs.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IntakeConfigPanel from './IntakeConfigPanel.tsx';
import type { IntakeConfig } from '../lib/intakeTypes.ts';

describe('IntakeConfigPanel', () => {
  it('defaults the Acceptance Criteria field to customfield_10200', () => {
    render(<IntakeConfigPanel initialConfig={null} artProjectKeys={[]} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/acceptance criteria field id/i)).toHaveValue('customfield_10200');
  });

  it('disables save until a default project or a project mapping exists', () => {
    render(<IntakeConfigPanel initialConfig={null} artProjectKeys={[]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save settings/i })).toBeDisabled();
  });

  it('enables save with only a project mapping (no default project needed)', () => {
    render(<IntakeConfigPanel initialConfig={null} artProjectKeys={[]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add project mapping/i }));
    fireEvent.change(screen.getByLabelText('Project name 1'), { target: { value: 'Cleanup Crew' } });
    fireEvent.change(screen.getByLabelText('Jira project key 1'), { target: { value: 'ENCUC' } });
    expect(screen.getByRole('button', { name: /save settings/i })).toBeEnabled();
  });

  it('assembles the config from default project, AC field, and the auto-create toggle', () => {
    const onSave = vi.fn();
    render(<IntakeConfigPanel initialConfig={null} artProjectKeys={[]} onSave={onSave} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Default project' }), { target: { value: 'enfct' } });
    fireEvent.change(screen.getByLabelText(/acceptance criteria field id/i), { target: { value: 'customfield_99999' } });
    fireEvent.click(screen.getByLabelText(/auto-create issues on import/i));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedConfig = onSave.mock.calls[0][0] as IntakeConfig;
    expect(savedConfig.projectKey).toBe('ENFCT');
    expect(savedConfig.acceptanceCriteriaFieldId).toBe('customfield_99999');
    expect(savedConfig.autoCreateOnImport).toBe(false);
  });

  it('captures project → Jira-key mappings (only fully-filled rows, project key upper-cased)', () => {
    const onSave = vi.fn();
    render(<IntakeConfigPanel initialConfig={null} artProjectKeys={[]} onSave={onSave} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Default project' }), { target: { value: 'DEFLT' } });
    fireEvent.click(screen.getByRole('button', { name: /add project mapping/i }));
    fireEvent.change(screen.getByLabelText('Project name 1'), { target: { value: 'Cleanup Crew' } });
    fireEvent.change(screen.getByLabelText('Jira project key 1'), { target: { value: 'encuc' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    const savedConfig = onSave.mock.calls[0][0] as IntakeConfig;
    expect(savedConfig.projectMappings).toEqual([{ projectName: 'Cleanup Crew', projectKey: 'ENCUC' }]);
  });
});
