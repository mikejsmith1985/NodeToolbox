// ReleaseDocumentTab.test.tsx — The Team Dashboard's Release Doc tab (GH #395).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatherRelease } from './releaseGather.ts';
import { fetchUnreleasedVersions } from './releaseDocumentJira.ts';
import { createEmptyDeploymentStep } from './releasePageStorage.ts';
import { readReleasePage, saveReleasePage, syncAllReleases } from './releasePageSync.ts';
import { ReleaseDocumentTab } from './ReleaseDocumentTab.tsx';

vi.mock('./releaseDocumentJira.ts', () => ({
  fetchUnreleasedVersions: vi.fn(),
  createReleaseGatherDeps: vi.fn(() => ({})),
  loadReleaseGatherSettings: vi.fn(() => ({ featureLinkField: 'customfield_90001', epicLinkFieldId: null, extraEpicProjectKeys: [] })),
}));
vi.mock('./releaseGather.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./releaseGather.ts')>()),
  gatherRelease: vi.fn(),
}));
vi.mock('./releasePageSync.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./releasePageSync.ts')>()),
  readReleasePage: vi.fn(),
  saveReleasePage: vi.fn(),
  syncAllReleases: vi.fn(),
}));

const PARENT_PAGE_URL = 'https://wiki.example.com/pages/viewpage.action?pageId=555';

const GATHERED = {
  warnings: [],
  groups: [
    {
      epicKey: 'DENP-20',
      epic: { key: 'DENP-20', summary: 'Recon reporting', issueTypeName: 'Epic', statusName: 'In Progress', assigneeName: 'Lee, Jordan', fixVersionNames: ['10/14/2026'], epicKey: null, notes: '' },
      items: [{ key: 'ENCUC-2', summary: 'Fix LIS mismatch', issueTypeName: 'Story', statusName: 'Done', assigneeName: 'Smith, Mike', fixVersionNames: ['10/14/2026'], epicKey: 'DENP-20', notes: '' }],
      outsideItems: [],
      misalignments: [],
    },
  ],
};

function renderTab(): void {
  render(<ReleaseDocumentTab projectKey="ENCUC" teamName="Cleanup Crew" teamProfileId="team-cuc" />);
}

describe('ReleaseDocumentTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(fetchUnreleasedVersions).mockResolvedValue([
      { id: '5', name: '10/14/2026', releaseDate: '2026-10-14', pageTitle: '2026Oct14' },
      { id: '6', name: 'Someday', releaseDate: null, pageTitle: null },
    ]);
    vi.mocked(gatherRelease).mockResolvedValue(GATHERED);
    vi.mocked(readReleasePage).mockResolvedValue({
      pageId: '777',
      pageUrl: 'https://wiki.example.com/x/777',
      versionNumber: 4,
      parsed: { deploymentSteps: [{ ...createEmptyDeploymentStep(), repo: 'usmg-esi-recon' }], notesByKey: new Map([['ENCUC-2', 'Waiting on QA']]) },
    });
    vi.mocked(saveReleasePage).mockResolvedValue({ pageUrl: 'https://wiki.example.com/x/777', wasCreated: false });
  });

  it('offers the unreleased versions to pick from, each with the page title it will get', async () => {
    renderTab();

    expect(await screen.findByRole('option', { name: '10/14/2026 — 2026Oct14' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Someday — needs a release date' })).toBeInTheDocument();
  });

  it('remembers the parent page for the team', async () => {
    renderTab();

    fireEvent.change(await screen.findByLabelText('Release document parent page'), { target: { value: PARENT_PAGE_URL } });

    expect(window.localStorage.getItem('tbxReleaseDocumentParents')).toContain('pageId=555');
  });

  it('pulls the release from Jira and merges in the notes and steps already on the page', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('Release document parent page'), { target: { value: PARENT_PAGE_URL } });
    fireEvent.change(screen.getByLabelText('Release'), { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: /Pull from Jira/ }));

    expect(await screen.findByText('Recon reporting')).toBeInTheDocument();
    expect(screen.getByText('Fix LIS mismatch')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes for ENCUC-2')).toHaveValue('Waiting on QA');
    expect(screen.getByLabelText('Repo for step 1')).toHaveValue('usmg-esi-recon');
    expect(vi.mocked(gatherRelease).mock.calls[0][0]).toEqual(expect.objectContaining({ teamProjectKey: 'ENCUC', versionName: '10/14/2026' }));
  });

  it('marks edits unsaved, then saves the page with them and links to it', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('Release document parent page'), { target: { value: PARENT_PAGE_URL } });
    fireEvent.change(screen.getByLabelText('Release'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Pull from Jira/ }));
    fireEvent.change(await screen.findByLabelText('Notes for ENCUC-2'), { target: { value: 'QA signed off' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save to Confluence/ }));

    await waitFor(() => expect(saveReleasePage).toHaveBeenCalled());
    const saveRequest = vi.mocked(saveReleasePage).mock.calls[0][0];
    expect(saveRequest).toEqual(expect.objectContaining({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14' }));
    expect(saveRequest.buildStorage({ deploymentSteps: [], notesByKey: new Map() })).toContain('QA signed off');
    expect(await screen.findByRole('link', { name: /Open page/ })).toHaveAttribute('href', 'https://wiki.example.com/x/777');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('says plainly what failed, and writes nothing', async () => {
    vi.mocked(gatherRelease).mockRejectedValue(new Error('Jira is unreachable'));
    renderTab();
    fireEvent.change(await screen.findByLabelText('Release document parent page'), { target: { value: PARENT_PAGE_URL } });
    fireEvent.change(screen.getByLabelText('Release'), { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: /Pull from Jira/ }));

    expect(await screen.findByText(/Jira is unreachable/)).toBeInTheDocument();
    expect(saveReleasePage).not.toHaveBeenCalled();
  });

  it('will not save a release that has no date to title it by', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('Release document parent page'), { target: { value: PARENT_PAGE_URL } });
    fireEvent.change(screen.getByLabelText('Release'), { target: { value: '6' } });

    expect(screen.getByRole('button', { name: /Save to Confluence/ })).toBeDisabled();
  });

  it('syncs every unreleased release at once and reports what happened to each', async () => {
    vi.mocked(syncAllReleases).mockResolvedValue([
      { versionName: '10/14/2026', pageTitle: '2026Oct14', outcome: 'updated' },
      { versionName: 'Someday', pageTitle: null, outcome: 'skipped-no-date' },
    ]);
    renderTab();
    const syncButton = await screen.findByRole('button', { name: /Sync all releases/ });
    expect(syncButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Release document parent page'), { target: { value: PARENT_PAGE_URL } });

    fireEvent.click(screen.getByRole('button', { name: /Sync all releases/ }));

    expect(await screen.findByText(/2026Oct14: updated/)).toBeInTheDocument();
    expect(screen.getByText(/Someday: skipped — needs a release date/)).toBeInTheDocument();
    const syncRequest = vi.mocked(syncAllReleases).mock.calls[0][0];
    expect(syncRequest.parentPageReference).toBe(PARENT_PAGE_URL);
    expect(syncRequest.versions.map((version) => version.name)).toEqual(['10/14/2026', 'Someday']);
  });
});
