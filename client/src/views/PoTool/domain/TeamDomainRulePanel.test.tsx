// TeamDomainRulePanel.test.tsx — Per-team domain-component config UI (spec 031, US4).

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamDomainRulePanel } from './TeamDomainRulePanel.tsx';
import { getTeamDomainComponents, useTeamDomainRuleStore } from './teamDomainRuleStore.ts';
import { classifyComponent, useComponentClassificationStore } from '../../AdminHub/lib/componentClassificationStore.ts';

beforeEach(() => {
  window.localStorage.clear();
  useTeamDomainRuleStore.setState({ rulesByTeam: {} });
  useComponentClassificationStore.setState({ classifications: {} });
});

describe('TeamDomainRulePanel', () => {
  it('saves the team\'s domain components', () => {
    render(<TeamDomainRulePanel teamProfileId="team-1" />);
    fireEvent.change(screen.getByLabelText(/Domain component names/i), { target: { value: 'Enrollment' } });
    fireEvent.click(screen.getByRole('button', { name: /Save team domain components/i }));
    expect(getTeamDomainComponents('team-1')).toEqual(['Enrollment']);
  });

  it('flags a name that is classified repo (never applies a repo as a domain tag)', () => {
    classifyComponent('payments-api', 'repo');
    classifyComponent('Enrollment', 'domain');
    render(<TeamDomainRulePanel teamProfileId="team-1" />);
    fireEvent.change(screen.getByLabelText(/Domain component names/i), { target: { value: 'Enrollment\npayments-api' } });
    fireEvent.click(screen.getByRole('button', { name: /Save team domain components/i }));
    expect(screen.getByText(/payments-api: classified as a repo/)).toBeInTheDocument();
  });

  it('applies only the valid domain components to the Feature', () => {
    classifyComponent('Enrollment', 'domain');
    const onApply = vi.fn();
    render(<TeamDomainRulePanel teamProfileId="team-1" onApplyToFeature={onApply} />);
    fireEvent.change(screen.getByLabelText(/Domain component names/i), { target: { value: 'Enrollment\nmystery' } });
    fireEvent.click(screen.getByRole('button', { name: /Save team domain components/i }));
    fireEvent.click(screen.getByRole('button', { name: /Apply 1 to this Feature/i }));
    expect(onApply).toHaveBeenCalledWith(['Enrollment']);
  });
});
