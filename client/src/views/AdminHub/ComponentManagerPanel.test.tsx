// ComponentManagerPanel.test.tsx — Render + the three flows (export, import, two-step remove). The Jira
// project picker and the async service calls are mocked; the pure parse/match/format helpers run for real.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listProjectComponents: vi.fn(),
  importComponentsToProjects: vi.fn(),
  bulkRemoveComponents: vi.fn(),
}));

vi.mock('../../components/JiraProjectPicker/index.tsx', () => ({
  default: ({ id, onChange }: { id: string; onChange: (value: string) => void }) => (
    <input aria-label={id} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('./lib/componentManager.ts', async (importActual) => {
  const actual = await importActual<typeof import('./lib/componentManager.ts')>();
  return { ...actual, listProjectComponents: mocks.listProjectComponents, importComponentsToProjects: mocks.importComponentsToProjects, bulkRemoveComponents: mocks.bulkRemoveComponents };
});

import { ComponentManagerPanel } from './ComponentManagerPanel.tsx';

beforeEach(() => vi.clearAllMocks());

describe('ComponentManagerPanel', () => {
  it('renders the three sections', () => {
    render(<ComponentManagerPanel />);
    expect(screen.getByText('🧩 Jira Component Manager')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bulk remove' })).toBeInTheDocument();
  });

  it('exports a project’s components into the textarea', async () => {
    mocks.listProjectComponents.mockResolvedValue([{ id: '1', name: 'repo-a' }, { id: '2', name: 'repo-b' }]);
    render(<ComponentManagerPanel />);
    fireEvent.change(screen.getByLabelText('component-export-project'), { target: { value: 'ABC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch components' }));
    await waitFor(() => expect((screen.getByLabelText('Exported component names') as HTMLTextAreaElement).value).toBe('repo-a\nrepo-b'));
    expect(screen.getByText(/2 component\(s\) in ABC/)).toBeInTheDocument();
  });

  it('imports names into the target projects and reports per project', async () => {
    mocks.importComponentsToProjects.mockResolvedValue([{ projectKey: 'ABC', created: ['repo-x'], skipped: [], failed: [] }]);
    render(<ComponentManagerPanel />);
    fireEvent.change(screen.getByLabelText(/Component names \(one per line\)/i), { target: { value: 'repo-x' } });
    fireEvent.change(screen.getByLabelText('Target project keys'), { target: { value: 'ABC' } });
    fireEvent.click(screen.getByRole('button', { name: /Import into/ }));
    await waitFor(() => expect(screen.getByText(/Done — created 1, skipped 0/)).toBeInTheDocument());
    expect(mocks.importComponentsToProjects).toHaveBeenCalledWith(['repo-x'], ['ABC']);
  });

  it('previews then deletes matched components on the two-step remove', async () => {
    mocks.listProjectComponents.mockResolvedValue([{ id: '10', name: 'repo-a' }]);
    mocks.bulkRemoveComponents.mockResolvedValue({ deleted: [{ id: '10', name: 'repo-a' }], failed: [], unmatched: [] });
    render(<ComponentManagerPanel />);

    fireEvent.change(screen.getByLabelText('component-remove-project'), { target: { value: 'ABC' } });
    fireEvent.change(screen.getByLabelText(/Component names to remove/i), { target: { value: 'repo-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find matches' }));

    await waitFor(() => expect(screen.getByText(/Will delete 1 component/)).toBeInTheDocument());
    // Nothing deleted yet — the confirm is a separate click.
    expect(mocks.bulkRemoveComponents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Delete 1 component/ }));
    await waitFor(() => expect(screen.getByText(/Deleted 1 component/)).toBeInTheDocument());
    expect(mocks.bulkRemoveComponents).toHaveBeenCalledWith('ABC', ['repo-a']);
  });
});
