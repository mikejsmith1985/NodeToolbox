// DeploymentStepsEditor.test.tsx — Typing in a release's deployment steps (GH #395).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeploymentStepsEditor } from './DeploymentStepsEditor.tsx';
import { createEmptyDeploymentStep, DEPLOYMENT_STEP_COLUMNS, type DeploymentStep } from './releasePageStorage.ts';

/** Two steps with recognisable repos. */
function buildSteps(): DeploymentStep[] {
  return [
    { ...createEmptyDeploymentStep(), repo: 'usmg-esi-recon' },
    { ...createEmptyDeploymentStep(), repo: 'usmg-enroll-esi-recon-report-infra' },
  ];
}

describe('DeploymentStepsEditor', () => {
  it('shows every field of every step', () => {
    render(<DeploymentStepsEditor onChange={vi.fn()} steps={buildSteps()} />);

    DEPLOYMENT_STEP_COLUMNS.forEach(({ header }) => expect(screen.getByLabelText(`${header} for step 1`)).toBeInTheDocument());
    expect(screen.getByLabelText('Repo for step 2')).toHaveValue('usmg-enroll-esi-recon-report-infra');
  });

  it('adds a blank step at the end', () => {
    const onChange = vi.fn();
    render(<DeploymentStepsEditor onChange={onChange} steps={buildSteps()} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add deployment step' }));

    expect(onChange.mock.calls[0][0]).toHaveLength(3);
    expect(onChange.mock.calls[0][0][2].repo).toBe('');
  });

  it('keeps pasted text exactly as written', () => {
    const onChange = vi.fn();
    const steps = buildSteps();
    render(<DeploymentStepsEditor onChange={onChange} steps={steps} />);

    fireEvent.change(screen.getByLabelText('Tag for step 1'), { target: { value: 'Does not matter' } });

    expect(onChange).toHaveBeenCalledWith([{ ...steps[0], tag: 'Does not matter' }, steps[1]]);
  });

  it('moves a step up and down, and cannot move past either end', () => {
    const onChange = vi.fn();
    const steps = buildSteps();
    render(<DeploymentStepsEditor onChange={onChange} steps={steps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(onChange).toHaveBeenLastCalledWith([steps[1], steps[0]]);
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step 2 down' })).toBeDisabled();
  });

  it('removes a step', () => {
    const onChange = vi.fn();
    const steps = buildSteps();
    render(<DeploymentStepsEditor onChange={onChange} steps={steps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));

    expect(onChange).toHaveBeenCalledWith([steps[1]]);
  });

  it('says so when there are no steps yet', () => {
    render(<DeploymentStepsEditor onChange={vi.fn()} steps={[]} />);

    expect(screen.getByText(/No deployment steps yet/)).toBeInTheDocument();
  });
});
