// JiraCreateView.test.tsx — Unit tests for the merged Jira Create thin shell (Templates + Intake).

import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The shell mounts the two REAL views unchanged; tests replace them with markers.
vi.mock('../JiraTemplateMaker/JiraTemplateMaker.tsx', () => ({
  default: () => <h1>Template Maker Mock</h1>,
}));
vi.mock('../JiraIntake/JiraIntake.tsx', () => ({
  default: () => <h1>Jira Intake Mock</h1>,
}));

import JiraCreateView from './JiraCreateView.tsx';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderJiraCreate(initialPath = '/jira-create') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <JiraCreateView />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('JiraCreateView', () => {
  it('defaults to the Templates tab when no tab param is present', () => {
    renderJiraCreate('/jira-create');

    expect(screen.getByRole('heading', { name: 'Template Maker Mock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Jira Intake Mock' })).not.toBeInTheDocument();
  });

  it('honors the ?tab= param as the authoritative tab', () => {
    renderJiraCreate('/jira-create?tab=intake');

    expect(screen.getByRole('heading', { name: 'Jira Intake Mock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Template Maker Mock' })).not.toBeInTheDocument();
  });

  it('falls back to Templates for an invalid tab param', () => {
    renderJiraCreate('/jira-create?tab=nonsense');

    expect(screen.getByRole('heading', { name: 'Template Maker Mock' })).toBeInTheDocument();
  });

  it('switching tabs updates the URL param and swaps the mounted view', () => {
    renderJiraCreate('/jira-create?tab=templates');

    fireEvent.click(screen.getByRole('button', { name: /Intake/ }));

    expect(screen.getByRole('heading', { name: 'Jira Intake Mock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Template Maker Mock' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('tab=intake');
  });

  it('leaves foreign query params untouched for the mounted view to consume', () => {
    renderJiraCreate('/jira-create?tab=templates&template=abc123');

    fireEvent.click(screen.getByRole('button', { name: /Intake/ }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('template=abc123');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('tab=intake');
  });
});
