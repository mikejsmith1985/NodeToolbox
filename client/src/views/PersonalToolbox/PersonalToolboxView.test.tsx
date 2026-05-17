// PersonalToolboxView.test.tsx — Unit tests for the configurable Personal Toolbox workspace.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/store/settingsStore.ts';
import PersonalToolboxView from './PersonalToolboxView.tsx';

vi.mock('./personalToolboxModules.ts', () => ({
  PERSONAL_TOOLBOX_MODULES: [
    {
      id: 'my-issues',
      title: 'My Issues',
      description: 'My issues module.',
      component: () => <div>My Issues Module Content</div>,
    },
    {
      id: 'dev-workspace',
      title: 'Dev Workspace',
      description: 'Dev workspace module.',
      component: () => <div>Dev Workspace Module Content</div>,
    },
    {
      id: 'reports-hub',
      title: 'Reports Hub',
      description: 'Reports module.',
      component: () => <div>Reports Hub Module Content</div>,
    },
  ],
}));

describe('PersonalToolboxView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({ personalToolboxModuleIds: [] });
  });

  it('defaults to all modules when no saved module list exists', () => {
    render(<PersonalToolboxView />);

    expect(screen.getByRole('tab', { name: 'My Issues' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dev Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reports Hub' })).toBeInTheDocument();
    expect(screen.getByText('My Issues Module Content')).toBeInTheDocument();
  });

  it('updates the selected module list when toggles are changed', () => {
    render(<PersonalToolboxView />);

    fireEvent.click(screen.getAllByRole('checkbox')[1]);

    expect(screen.queryByRole('tab', { name: 'Dev Workspace' })).not.toBeInTheDocument();
  });

  it('reorders selected modules when move actions are clicked', async () => {
    useSettingsStore.setState({ personalToolboxModuleIds: ['my-issues', 'dev-workspace', 'reports-hub'] });
    render(<PersonalToolboxView />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);

    await waitFor(() => {
      expect(useSettingsStore.getState().personalToolboxModuleIds).toEqual([
        'dev-workspace',
        'my-issues',
        'reports-hub',
      ]);
    });
  });
});

