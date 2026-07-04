// PiReviewTab.test.tsx — Unit tests for the multi-team Confluence-backed PI Review ART tab.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { ToastProvider } from '../../components/Toast/ToastProvider.tsx';
import type { CapacitySummary } from '../SprintDashboard/capacityModel.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { writePiReviewCapacitySummary } from './piReviewTable.ts';
import styles from './PiReviewTab.module.css';

const {
  mockDownloadPiReviewPanelImage,
  mockFetchConfluencePageByReference,
  mockJiraGet,
  mockJiraPost,
  mockJiraPut,
  mockResolveConfluencePageIdFromReference,
  mockUpdateConfluencePage,
} = vi.hoisted(() => ({
  mockDownloadPiReviewPanelImage: vi.fn(),
  mockFetchConfluencePageByReference: vi.fn(),
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
  mockJiraPut: vi.fn(),
  mockResolveConfluencePageIdFromReference: vi.fn(),
  mockUpdateConfluencePage: vi.fn(),
}));

vi.mock('../../services/confluenceApi.ts', () => ({
  fetchConfluencePageByReference: mockFetchConfluencePageByReference,
  resolveConfluencePageIdFromReference: mockResolveConfluencePageIdFromReference,
  updateConfluencePage: mockUpdateConfluencePage,
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
  jiraPut: mockJiraPut,
}));

vi.mock('./piReviewPdf.ts', () => ({
  downloadPiReviewPanelImage: mockDownloadPiReviewPanelImage,
}));

import PiReviewTab from './PiReviewTab.tsx';

const ALPHA_PAGE = {
  id: '12345',
  type: 'page',
  title: 'Alpha PI 26.3 Review',
  version: { number: 7 },
  body: {
    storage: {
      value: `
        <table>
          <tbody>
            <tr>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th colspan="2">26.3 ask from the Business / PO</th>
              <th></th>
              <th></th>
              <th></th>
              <th></th>
            </tr>
            <tr>
              <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
              <th>Priority</th>
              <th>Feature</th>
              <th>Point Estimate</th>
              <th>Dependency</th>
              <th>Risks</th>
              <th>Committed?</th>
              <th>Notes</th>
            </tr>
            <tr>
              <td>Yes</td>
              <td>P1</td>
              <td>Feature A</td>
              <td>8</td>
              <td>Platform</td>
              <td>Vendor delay</td>
              <td>Yes</td>
              <td>Needs review</td>
            </tr>
          </tbody>
        </table>
        <h2>Confidence Vote Tracking</h2>
        <table>
          <tbody>
            <tr>
              <th>Week Of</th>
              <th>Fist of Five</th>
              <th>Notes</th>
            </tr>
            <tr>
              <td>2026-05-19</td>
              <td>4</td>
              <td>Green for the week</td>
            </tr>
          </tbody>
        </table>
      `,
      representation: 'storage',
    },
  },
};

const BETA_PAGE = {
  ...ALPHA_PAGE,
  id: '67890',
  title: 'Beta PI 26.3 Review',
  body: {
    storage: {
      value: ALPHA_PAGE.body.storage.value.replace('Feature A', 'Feature B').replace('Needs review', 'Beta ready'),
      representation: 'storage',
    },
  },
};

const ALPHA_PAGE_WITH_FEATURE_KEY = {
  ...ALPHA_PAGE,
  body: {
    storage: {
      value: ALPHA_PAGE.body.storage.value
        .replace('Feature A', 'DENP-1352')
        .replace('<td>P1</td>', '<td>Manual priority</td>')
        .replace('<td>8</td>', '<td>5</td>')
        .replace('<td>Platform</td>', '<td>Legacy dependency note</td>')
        .replace('<td>Vendor delay</td>', '<td>Legacy risk note</td>'),
      representation: 'storage',
    },
  },
};

const ALPHA_PAGE_WITH_DECIMAL_CONFIDENCE = {
  ...ALPHA_PAGE,
  body: {
    storage: {
      value: ALPHA_PAGE.body.storage.value.replace('<td>4</td>', '<td>3.7</td>'),
      representation: 'storage',
    },
  },
};

const ALPHA_PAGE_WITH_HALF_CONFIDENCE = {
  ...ALPHA_PAGE,
  body: {
    storage: {
      value: ALPHA_PAGE.body.storage.value.replace('<td>4</td>', '<td>2.5</td>'),
      representation: 'storage',
    },
  },
};

const DEFAULT_TEAMS: ArtTeam[] = [
  {
    id: 'team-1',
    name: 'Alpha Team',
    boardId: '42',
    piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  },
  {
    id: 'team-2',
    name: 'Beta Team',
    boardId: '43',
    piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/67890/Beta',
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  },
];

function createTeamCapacitySummary(): CapacitySummary {
  return {
    summaryLabel: 'Alpha Team Capacity',
    startDate: '2026-05-18',
    endDate: '2026-05-22',
    workDayCount: 5,
    totalCapacityPoints: 12.5,
    recommendedCapacityPoints: 10,
    roleCapacities: {
      Dev: 10,
      'Dev Lead': 0,
      QE: 2.5,
      'Test Lead': 0,
      BT: 0,
      SL: 0,
      SA: 0,
      PO: 0,
      TPO: 0,
      SM: 0,
    },
  };
}

function renderPiReviewTab(
  teams: ArtTeam[] = DEFAULT_TEAMS,
  mode: 'authoring' | 'readout' = 'authoring',
  teamCapacitySummaries?: Record<string, CapacitySummary | null>,
) {
  return render(
    <ToastProvider>
      <PiReviewTab
        mode={mode}
        selectedPiName="PI 26.3"
        teamCapacitySummaries={teamCapacitySummaries}
        teams={teams}
      />
    </ToastProvider>,
  );
}

function enterEditMode(piReviewSection: HTMLElement) {
  fireEvent.click(within(piReviewSection).getByRole('button', { name: /edit pi review/i }));
}

function createAlphaPageWithExtraPiReviewRows(extraRowsMarkup: string) {
  return {
    ...ALPHA_PAGE,
    body: {
      storage: {
        value: ALPHA_PAGE.body.storage.value.replace(
          '            </tr>\n          </tbody>\n        </table>',
          `            </tr>\n${extraRowsMarkup}\n          </tbody>\n        </table>`,
        ),
        representation: 'storage',
      },
    },
  };
}

function createPiReviewImportFile(rows: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet3');
  const workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([workbookBuffer], '26.3 Commit.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('PiReviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockJiraGet.mockResolvedValue({ issues: [] });
    mockJiraPost.mockResolvedValue(undefined);
    mockJiraPut.mockResolvedValue(undefined);
    mockResolveConfluencePageIdFromReference.mockImplementation((pageReference: string) => {
      if (pageReference.includes('12345')) {
        return '12345';
      }
      if (pageReference.includes('67890')) {
        return '67890';
      }
      return null;
    });
  });

  it('shows guidance when no team or fallback PI Review page is configured', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/999/Shared' }));
    renderPiReviewTab([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ]);
    const para = screen.getByRole('paragraph');
    expect(para).toHaveTextContent(/PI Review Page URL/i);
    expect(para).toHaveTextContent(/add an explicit pi review page url to each art team/i);
    expect(para).not.toHaveTextContent(/shared default pi review page url or id/i);
  });

  it('auto-loads one Confluence page per configured team and switches between team tabs', async () => {
    mockFetchConfluencePageByReference.mockImplementation((pageReference: string) => {
      if (pageReference.includes('12345')) {
        return Promise.resolve(ALPHA_PAGE);
      }
      return Promise.resolve(BETA_PAGE);
    });

    renderPiReviewTab();

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    const betaSection = screen.getByRole('region', { name: /beta team pi review/i, hidden: true });
    expect(screen.getByRole('tab', { name: /alpha team/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /beta team/i })).toHaveAttribute('aria-selected', 'false');
    expect(alphaSection).toBeVisible();
    expect(betaSection).not.toBeVisible();
    expect(screen.getByText('Feature A')).toBeInTheDocument();
    expect(within(alphaSection).getByText(/committed points: 8/i)).toBeInTheDocument();
    expect(within(alphaSection).queryByRole('button', { name: /add pi review row/i })).not.toBeInTheDocument();
    expect(mockFetchConfluencePageByReference).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('tab', { name: /beta team/i }));

    expect(screen.getByRole('tab', { name: /alpha team/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /beta team/i })).toHaveAttribute('aria-selected', 'true');
    expect(alphaSection).not.toBeVisible();
    expect(betaSection).toBeVisible();
    expect(within(betaSection).getByText('Feature B')).toBeInTheDocument();
  });

  it('defaults to a read-only view mode and only shows structural controls in edit mode', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByText(/view mode is on/i)).toBeInTheDocument();
    expect(within(alphaSection).getByText('Feature A')).toBeInTheDocument();
    expect(within(alphaSection).getByRole('button', { name: /edit pi review/i })).toHaveAttribute('aria-pressed', 'false');
    expect(within(alphaSection).queryByLabelText(/feature for alpha team row 1/i)).not.toBeInTheDocument();
    expect(within(alphaSection).queryByRole('button', { name: /move up/i })).not.toBeInTheDocument();
    expect(within(alphaSection).getByRole('button', { name: /save to confluence/i })).toBeDisabled();

    enterEditMode(alphaSection);

    expect(within(alphaSection).getByText(/edit mode is on/i)).toBeInTheDocument();
    expect(within(alphaSection).getByRole('button', { name: /done editing/i })).toHaveAttribute('aria-pressed', 'true');
    expect(within(alphaSection).getByLabelText(/feature for alpha team row 1/i)).toBeInTheDocument();
    expect(within(alphaSection).getByRole('button', { name: /save to confluence/i })).toBeInTheDocument();

    fireEvent.change(within(alphaSection).getByLabelText(/feature for alpha team row 1/i), {
      target: { value: 'Updated while editing' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /done editing/i }));
    expect(within(alphaSection).queryByLabelText(/feature for alpha team row 1/i)).not.toBeInTheDocument();
    expect(within(alphaSection).getByRole('button', { name: /save to confluence/i })).toBeEnabled();
  });

  it('uses Team Dashboard as the authoring handoff in readout mode', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]], 'readout');

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByText(/readout mode is on/i)).toBeInTheDocument();
    expect(within(alphaSection).queryByRole('button', { name: /edit pi review/i })).not.toBeInTheDocument();
    const teamDashboardLink = within(alphaSection).getByRole('link', { name: /open in team dashboard/i });
    expect(teamDashboardLink).toHaveAttribute('href', '/sprint-dashboard');
    expect(within(alphaSection).queryByRole('button', { name: /save to confluence/i })).not.toBeInTheDocument();
  });

  it('loads Jira-enriched feature summaries, synced columns, and migrated notes in view mode', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_FEATURE_KEY);
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      piReviewTargetStartFieldId: 'customfield_12345',
      piReviewTargetEndFieldId: 'customfield_12346',
    }));
    mockJiraGet.mockResolvedValue({
      issues: [
        {
          id: '10001',
          key: 'DENP-1352',
          fields: {
            summary: '26.3 Enrollment Support',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            priority: { name: 'Highest', iconUrl: '' },
            assignee: null,
            reporter: null,
            issuetype: { name: 'Feature', iconUrl: '' },
            created: '',
            updated: '',
            duedate: '2026-06-12',
            description: null,
            customfield_10111: 13,
            customfield_12345: '2026-05-30',
            customfield_12346: '2026-06-10',
            fixVersions: [{ id: '301', name: '26.3' }],
            issuelinks: [
              {
                type: { outward: 'blocks' },
                outwardIssue: {
                  key: 'PLAT-5',
                  fields: {
                    summary: 'Platform work',
                    status: { name: 'Blocked' },
                    labels: ['impediment'],
                  },
                },
              },
            ],
          },
        },
      ],
    });

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    // The region shell appears before its feature rows finish rendering, so await the first piece of
    // row content (findBy polls) before the synchronous assertions below — otherwise this races and
    // flakes under parallel test load.
    expect(await within(alphaSection).findByText(/26\.3 Enrollment Support/i, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(within(alphaSection).getByRole('link', { name: 'DENP-1352' })).toHaveAttribute(
      'href',
      'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/DENP-1352',
    );
    // "Highest" now appears in both the priority cell and the Jira load-delta banner — both are valid.
    expect(within(alphaSection).getAllByText('Highest').length).toBeGreaterThanOrEqual(1);
    // "PLAT-5" now appears in the dependency/risk cells and also in the Jira load-delta banner.
    expect(within(alphaSection).getAllByText(/PLAT-5 - Platform work \(Blocked\)/i).length).toBeGreaterThanOrEqual(2);
    // Notes migration text now appears in both the data cell and the Jira load-delta banner.
    expect(within(alphaSection).getAllByText(/Dependency note: Legacy dependency note/i).length).toBeGreaterThanOrEqual(1);
    expect(within(alphaSection).getAllByText(/Risk note: Legacy risk note/i).length).toBeGreaterThanOrEqual(1);
    expect(within(alphaSection).getByText('Target Start: 2026-05-30')).toHaveClass(styles.featureDatePill, styles.featureDatePillStart);
    expect(within(alphaSection).getByText('Target End: 2026-06-10')).toHaveClass(styles.featureDatePill, styles.featureDatePillEnd);
    expect(within(alphaSection).getByText('Due Date: 2026-06-12')).toHaveClass(styles.featureDatePill, styles.featureDatePillDue);
    expect(within(alphaSection).getByText('Fix Version: 26.3')).toHaveClass(styles.featureDatePill, styles.featureDatePillFixVersion);
    expect(within(alphaSection).getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('updates Jira feature status directly from the PI Review feature row in view mode', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_FEATURE_KEY);
    let searchCallCount = 0;
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/transitions')) {
        return Promise.resolve({
          transitions: [
            { id: '41', name: 'Done' },
          ],
        });
      }
      if (requestPath.includes('/search')) {
        searchCallCount += 1;
        return Promise.resolve({
          issues: [
            {
              id: '10001',
              key: 'DENP-1352',
              fields: {
                summary: '26.3 Enrollment Support',
                status: {
                  name: searchCallCount > 1 ? 'Done' : 'In Progress',
                  statusCategory: { key: searchCallCount > 1 ? 'done' : 'indeterminate' },
                },
                priority: { name: 'Highest', iconUrl: '' },
                assignee: null,
                reporter: null,
                issuetype: { name: 'Feature', iconUrl: '' },
                created: '',
                updated: '',
                description: null,
                customfield_10111: 13,
                issuelinks: [],
              },
            },
          ],
        });
      }
      return Promise.resolve({ issues: [] });
    });

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /status: in progress/i }));
    const statusSelect = await within(alphaSection).findByRole('combobox', { name: /change jira status for denp-1352/i });
    await waitFor(() => {
      expect(within(alphaSection).getByRole('option', { name: 'Done' })).toBeInTheDocument();
    });
    fireEvent.change(statusSelect, {
      target: { value: '41' },
    });

    await waitFor(() => {
      expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1352/transitions', {
        transition: { id: '41' },
      });
    });
    await waitFor(() => {
      expect(within(alphaSection).getByText('Status: Done')).toBeInTheDocument();
    });
  });

  it('prompts for missing Jira fields when a transition requires them and retries after applying values', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_FEATURE_KEY);
    let searchCallCount = 0;
    let transitionPostAttemptCount = 0;
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/transitions?expand=transitions.fields')) {
        return Promise.resolve({
          transitions: [
            {
              id: '41',
              fields: {
                customfield_12345: {
                  name: 'Product Owner',
                  required: true,
                  schema: { type: 'user' },
                  allowedValues: [{ accountId: 'abc-123', displayName: 'Taylor Owner' }],
                },
                parent: {
                  name: 'Parent Link',
                  required: true,
                },
              },
            },
          ],
        });
      }
      if (requestPath.includes('/transitions')) {
        return Promise.resolve({
          transitions: [{ id: '41', name: 'Done' }],
        });
      }
      if (requestPath.includes('/search')) {
        searchCallCount += 1;
        return Promise.resolve({
          issues: [
            {
              id: '10001',
              key: 'DENP-1352',
              fields: {
                summary: '26.3 Enrollment Support',
                status: {
                  name: searchCallCount > 1 ? 'Done' : 'In Progress',
                  statusCategory: { key: searchCallCount > 1 ? 'done' : 'indeterminate' },
                },
                priority: { name: 'Highest', iconUrl: '' },
                assignee: null,
                reporter: null,
                issuetype: { name: 'Feature', iconUrl: '' },
                created: '',
                updated: '',
                description: null,
                customfield_10111: 13,
                issuelinks: [],
              },
            },
          ],
        });
      }
      return Promise.resolve({ issues: [] });
    });
    mockJiraPost.mockImplementation((requestPath: string) => {
      if (!requestPath.includes('/transitions')) {
        return Promise.resolve(undefined);
      }
      transitionPostAttemptCount += 1;
      if (transitionPostAttemptCount === 1) {
        return Promise.reject(
          new Error('Jira POST /rest/api/2/issue/DENP-1370/transitions failed: 400 — The following fields are required: Product Owner, Parent Link'),
        );
      }
      return Promise.resolve(undefined);
    });

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /status: in progress/i }));
    fireEvent.change(
      await within(alphaSection).findByRole('combobox', { name: /change jira status for denp-1352/i }),
      { target: { value: '41' } },
    );

    await waitFor(() => {
      expect(within(alphaSection).getByText(/jira missing required fields/i)).toBeInTheDocument();
    });
    fireEvent.change(within(alphaSection).getByLabelText(/Product Owner for DENP-1352/i), {
      target: { value: 'abc-123' },
    });
    fireEvent.change(within(alphaSection).getByLabelText(/Parent Link for DENP-1352/i), {
      target: { value: 'ART-999' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /apply fields & retry/i }));

    await waitFor(() => {
      expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1352', {
        fields: {
          customfield_12345: { accountId: 'abc-123' },
          parent: { key: 'ART-999' },
        },
      });
    });
    await waitFor(() => {
      expect(within(alphaSection).getByText('Status: Done')).toBeInTheDocument();
    });
  });

  it('renders checkbox columns as visual readout icons instead of literal yes or no text', async () => {
    const alphaPageWithUncheckedCheckboxes = createAlphaPageWithExtraPiReviewRows(`
            <tr>
              <td>No</td>
              <td>P2</td>
              <td>Stretch Feature</td>
              <td>5</td>
              <td>None</td>
              <td>Low</td>
              <td></td>
              <td>Stretch note</td>
            </tr>`);
    mockFetchConfluencePageByReference.mockResolvedValue(alphaPageWithUncheckedCheckboxes);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByRole('img', { name: /committed to pi\?: yes/i })).toHaveTextContent('✓');
    expect(within(alphaSection).getByRole('img', { name: /carry-over: no/i })).toHaveTextContent('');
    expect(within(alphaSection).queryByText(/^Yes$/)).not.toBeInTheDocument();
    expect(within(alphaSection).queryByText(/^No$/)).not.toBeInTheDocument();
  });

  it('exports a high-resolution PI Review PNG for the current team panel', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockDownloadPiReviewPanelImage.mockResolvedValue(undefined);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).queryByRole('button', { name: /export pi review pdf/i })).not.toBeInTheDocument();
    fireEvent.click(within(alphaSection).getByRole('button', { name: /export pi review png/i }));

    await waitFor(() => {
      expect(mockDownloadPiReviewPanelImage).toHaveBeenCalledTimes(1);
    });

    const [panelElement, fileName] = mockDownloadPiReviewPanelImage.mock.calls[0];
    expect(panelElement).toBe(alphaSection);
    expect(fileName).toBe('pi-review-alpha-team-pi-26-3.png');
  });

  it('ignores edits for only the current team panel by restoring the last loaded state', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.change(within(alphaSection).getByLabelText(/notes for alpha team row 1/i), {
      target: { value: 'Changed locally only' },
    });
    expect(within(alphaSection).getByText(/unsaved changes/i)).toBeInTheDocument();

    fireEvent.click(within(alphaSection).getByRole('button', { name: /ignore edits/i }));

    expect(within(alphaSection).queryByLabelText(/notes for alpha team row 1/i)).not.toBeInTheDocument();
    expect(within(alphaSection).getByText('Needs review')).toBeInTheDocument();
    expect(within(alphaSection).queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });

  it('adds and saves custom grouping lines inline below the selected row', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }));

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /add custom line below/i })[0]);
    fireEvent.change(within(alphaSection).getByLabelText(/custom line text for alpha team row 1/i), {
      target: { value: 'Architecture Work' },
    });
    fireEvent.click(await within(alphaSection).findByRole('button', { name: /purple/i }));
    fireEvent.change(within(alphaSection).getByLabelText(/notes for alpha team row 1/i), {
      target: { value: 'Ready to save lines' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('data-node-toolbox-pi-review-grouping="custom"');
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('Architecture Work');
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('#8b5cf6');
  });

  it('saves feature keys back to Confluence as Jira browse links', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_FEATURE_KEY);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE_WITH_FEATURE_KEY,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    expect(within(alphaSection).getByRole('button', { name: /save to confluence/i })).toBeEnabled();
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain(
      '<a href="https://jira.healthspring-jira-prod.aws.zilverton.com/browse/DENP-1352">DENP-1352</a>',
    );
  });

  it('keeps one custom grouping line with its color after a save when Confluence strips the private markers', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue
              .replace(/\sdata-node-toolbox-pi-review-grouping="custom"/g, '')
              .replace(/\sdata-node-toolbox-pi-review-grouping-payload='[^']*'/g, '')
              .replace(/\sdata-node-toolbox-pi-review-capacity="summary"/g, '')
              .replace(/\sdata-node-toolbox-pi-review-capacity-payload="[^"]*"/g, ''),
            representation: 'storage',
          },
        },
      }));

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /add custom line below/i })[0]);
    fireEvent.change(within(alphaSection).getByLabelText(/custom line text for alpha team row 1/i), {
      target: { value: 'Architecture Work' },
    });
    fireEvent.click(await within(alphaSection).findByRole('button', { name: /purple/i }));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(within(alphaSection).getByRole('button', { name: /edit pi review/i })).toBeInTheDocument();
    });

    const renderedGroupingLines = within(alphaSection).getAllByText('Architecture Work');
    expect(renderedGroupingLines).toHaveLength(1);
    expect(renderedGroupingLines[0].closest('td')).toHaveStyle('border-top-color: rgb(139, 92, 246)');

    enterEditMode(alphaSection);
    expect(within(alphaSection).getByLabelText(/custom line text for alpha team row 1/i)).toHaveValue('Architecture Work');
  });

  it('toggles the Stretch Goals line off when the same row button is clicked again', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /set stretch goals line below/i })[0]);
    expect(within(alphaSection).getByText(/stretch goals below/i)).toBeInTheDocument();
    fireEvent.click(within(alphaSection).getByRole('button', { name: /remove stretch goals line/i }));
    expect(within(alphaSection).queryByText(/stretch goals below/i)).not.toBeInTheDocument();
  });

  it('backfills the Jira feature estimate on save when Jira is blank and the PI Review already has a value', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_FEATURE_KEY);
    mockJiraGet.mockResolvedValue({
      issues: [
        {
          id: '10001',
          key: 'DENP-1352',
          fields: {
            summary: '26.3 Enrollment Support',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            priority: { name: 'Highest', iconUrl: '' },
            assignee: null,
            reporter: null,
            issuetype: { name: 'Feature', iconUrl: '' },
            created: '',
            updated: '',
            description: null,
            customfield_10111: null,
            issuelinks: [],
          },
        },
      ],
    });
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE_WITH_FEATURE_KEY,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }));

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.change(within(alphaSection).getByLabelText(/notes for alpha team row 1/i), {
      target: { value: 'Save the estimate back to Jira' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockJiraPut).toHaveBeenCalledTimes(1);
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1352', {
      fields: {
        customfield_10111: 5,
      },
    });
  });

  it('exports the read-only document snapshot even when the user starts in edit mode', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    let exportedHasEditableTextInput = true;
    let exportedHasEditableTextarea = true;
    mockDownloadPiReviewPanelImage.mockImplementation(async (panelElement: HTMLElement) => {
      exportedHasEditableTextInput = panelElement.querySelector('input[type="text"]') !== null;
      exportedHasEditableTextarea = panelElement.querySelector('textarea') !== null;
    });

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    expect(within(alphaSection).getByLabelText(/feature for alpha team row 1/i)).toBeInTheDocument();

    fireEvent.click(within(alphaSection).getByRole('button', { name: /export pi review png/i }));

    await waitFor(() => {
      expect(mockDownloadPiReviewPanelImage).toHaveBeenCalledTimes(1);
    });
    expect(exportedHasEditableTextInput).toBe(false);
    expect(exportedHasEditableTextarea).toBe(false);
    expect(within(alphaSection).getByLabelText(/feature for alpha team row 1/i)).toBeInTheDocument();
  });

  it('saves edited rows and confidence votes back to the selected team page', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockUpdateConfluencePage.mockResolvedValue({
      ...ALPHA_PAGE,
      version: { number: 8 },
      body: {
        storage: {
          value: ALPHA_PAGE.body.storage.value
            .replace('Needs review', 'Ready to commit')
            .replace('Green for the week', 'Still confident'),
          representation: 'storage',
        },
      },
    });

    renderPiReviewTab([DEFAULT_TEAMS[0]], 'authoring', { 'team-1': createTeamCapacitySummary() });

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.change(
      within(alphaSection).getByLabelText(/notes for alpha team row 1/i),
      { target: { value: 'Ready to commit' } },
    );
    fireEvent.change(
      within(alphaSection).getByLabelText(/notes for alpha team confidence row 1/i),
      { target: { value: 'Still confident' } },
    );
    fireEvent.change(
      within(alphaSection).getByLabelText(/exact fist of five vote for alpha team confidence row 1/i),
      { target: { value: '3.7' } },
    );
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });

    const savePayload = mockUpdateConfluencePage.mock.calls[0][0];
    expect(savePayload.pageId).toBe('12345');
    expect(savePayload.nextVersionNumber).toBe(8);
    expect(savePayload.storageValue).toContain('Alpha Team Capacity');
    expect(savePayload.storageValue).toContain('100% Capacity (pts)');
    expect(savePayload.storageValue).toContain('Ready to commit');
    expect(savePayload.storageValue).toContain('3.7');
    expect(savePayload.storageValue).toContain('Still confident');
  });

  it('renders the current team capacity above the PI Review table', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]], 'authoring', { 'team-1': createTeamCapacitySummary() });

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByRole('heading', { name: /team capacity/i })).toBeInTheDocument();
    expect(within(alphaSection).getByText('Alpha Team Capacity')).toBeInTheDocument();
    expect(within(alphaSection).getByText('12.5')).toBeInTheDocument();
    expect(within(alphaSection).getByText('Dev: 10 pts')).toBeInTheDocument();
    expect(within(alphaSection).getByText('QE: 2.5 pts')).toBeInTheDocument();
  });

  it('falls back to the saved Confluence capacity snapshot when no live capacity override is provided', async () => {
    const alphaPageWithSavedCapacity = {
      ...ALPHA_PAGE,
      body: {
        storage: {
          value: writePiReviewCapacitySummary(ALPHA_PAGE.body.storage.value, createTeamCapacitySummary()),
          representation: 'storage',
        },
      },
    };
    mockFetchConfluencePageByReference.mockResolvedValue(alphaPageWithSavedCapacity);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...alphaPageWithSavedCapacity,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByText('Alpha Team Capacity')).toBeInTheDocument();
    expect(within(alphaSection).getByText('Dev: 10 pts')).toBeInTheDocument();

    enterEditMode(alphaSection);
    fireEvent.change(within(alphaSection).getByLabelText(/notes for alpha team row 1/i), {
      target: { value: 'Keep saved capacity' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('Alpha Team Capacity');
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('<strong>Dev:</strong> 10 pts');
  });

  it('imports a Confluence XLSX export as an unsaved PI Review draft', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    const importFile = createPiReviewImportFile([
      [
        'YES - If this is a Carry-Over from a 26.2 Commit?',
        'Priority',
        'Feature ',
        'Point Estimate',
        'Dependency',
        ' Risks',
        ' Committed?',
      ],
      [
        'No',
        'Medium',
        'DENP-1352 - 26.3 Enrollment Support',
        0,
        'TRACKING FEATURE ONLY - No DEV Work',
        'N/A',
        'Tracking feature, no Dev',
      ],
    ]);

    fireEvent.change(within(alphaSection).getByLabelText(/import pi review xlsx for alpha team/i), {
      target: { files: [importFile] },
    });

    await waitFor(() => {
      expect(within(alphaSection).getByDisplayValue('DENP-1352 - 26.3 Enrollment Support')).toBeInTheDocument();
    });
    expect(within(alphaSection).getByDisplayValue('Tracking feature, no Dev')).toBeInTheDocument();
    expect(within(alphaSection).getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('pastes Jira date tables and updates the matching Jira issue dates immediately', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_FEATURE_KEY);
    mockJiraGet
      .mockResolvedValueOnce({
        issues: [
          {
            id: '10001',
            key: 'DENP-1352',
            fields: {
              summary: '26.3 Enrollment Support',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: { name: 'Highest', iconUrl: '' },
              assignee: null,
              reporter: null,
              issuetype: { name: 'Feature', iconUrl: '' },
              created: '',
              updated: '',
              description: null,
              issuelinks: [],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: '10001',
            key: 'DENP-1352',
            fields: {
              summary: '26.3 Enrollment Support',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: { name: 'Highest', iconUrl: '' },
              assignee: null,
              reporter: null,
              issuetype: { name: 'Feature', iconUrl: '' },
              created: '',
              updated: '',
              duedate: '2026-06-25',
              description: null,
              customfield_10101: '2026-05-21',
              customfield_10102: '2026-06-03',
              issuelinks: [],
            },
          },
        ],
      });

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /paste & update jira dates/i }));
    fireEvent.change(within(alphaSection).getByLabelText(/jira date paste for alpha team/i), {
      target: {
        value: [
          'Jira Key\tTarget Start\tTarget End\tDue Date',
          'DENP-1352\t5/21/2026\t6/3/2026\t6/25/2026',
        ].join('\n'),
      },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /apply jira date updates/i }));

    await waitFor(() => {
      expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DENP-1352', {
        fields: {
          customfield_10101: '2026-05-21',
          customfield_10102: '2026-06-03',
          duedate: '2026-06-25',
        },
      });
    });
    await waitFor(() => {
      expect(within(alphaSection).getByText('Target Start: 2026-05-21')).toBeInTheDocument();
    });
    expect(within(alphaSection).getByText('Target End: 2026-06-03')).toBeInTheDocument();
    expect(within(alphaSection).getByText('Due Date: 2026-06-25')).toBeInTheDocument();
    expect(within(alphaSection).queryByLabelText(/jira date paste for alpha team/i)).not.toBeInTheDocument();
  });

  it('renders fist-of-five hand-image options in edit mode for each confidence vote row', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    expect(
      within(alphaSection).getByRole('button', {
        name: /set fist of five vote to 5 for alpha team confidence row 1/i,
      }),
    ).toBeInTheDocument();
  });

  it('shows a confidence-specific edit action in authoring mode', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /edit confidence votes/i }));

    expect(
      within(alphaSection).getByLabelText(/exact fist of five vote for alpha team confidence row 1/i),
    ).toBeInTheDocument();
    expect(
      within(alphaSection).getByRole('button', { name: /add weekly confidence vote/i }),
    ).toBeInTheDocument();
    expect(
      within(alphaSection).getByRole('button', { name: /save confidence votes/i }),
    ).toBeInTheDocument();
  });

  it('adds a weekly confidence vote from the confidence section', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /edit confidence votes/i }));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add weekly confidence vote/i }));

    const secondWeekInput = within(alphaSection).getByLabelText(/week of for alpha team confidence row 2/i) as HTMLInputElement;
    const secondVoteInput = within(alphaSection).getByLabelText(/exact fist of five vote for alpha team confidence row 2/i) as HTMLInputElement;

    expect(secondWeekInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(secondVoteInput.value).toBe('3');
  });

  it('saves edited confidence votes from the confidence section action row', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockUpdateConfluencePage.mockResolvedValue({
      ...ALPHA_PAGE,
      version: { number: 8 },
      body: {
        storage: {
          value: ALPHA_PAGE.body.storage.value
            .replace('Green for the week', 'Confidence section save')
            .replace('4', '4.2'),
          representation: 'storage',
        },
      },
    });

    renderPiReviewTab([DEFAULT_TEAMS[0]], 'authoring', { 'team-1': createTeamCapacitySummary() });

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /edit confidence votes/i }));
    fireEvent.change(
      within(alphaSection).getByLabelText(/notes for alpha team confidence row 1/i),
      { target: { value: 'Confidence section save' } },
    );
    fireEvent.change(
      within(alphaSection).getByLabelText(/exact fist of five vote for alpha team confidence row 1/i),
      { target: { value: '4.2' } },
    );
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save confidence votes/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('Confidence section save');
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('4.2');
  });

  it('renders vote 4 with four raised fingers and one folded finger', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);

    const voteFourButton = within(alphaSection).getByRole('button', {
      name: /set fist of five vote to 4 for alpha team confidence row 1/i,
    });
    const fingerRectangles = Array.from(voteFourButton.querySelectorAll('svg rect')).slice(1, 6);

    expect(fingerRectangles).toHaveLength(5);
    expect(fingerRectangles.slice(0, 4).every((fingerRectangle) => (
      fingerRectangle.classList.contains(styles.fingerRaised)
    ))).toBe(true);
    expect(fingerRectangles[4]).toHaveClass(styles.fingerFolded);
  });

  it('renders a decimal vote with a partially filled next finger and shows the exact value', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_DECIMAL_CONFIDENCE);

    renderPiReviewTab([DEFAULT_TEAMS[0]], 'readout');

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByText('3.7')).toBeInTheDocument();
    const readOnlyVote = alphaSection.querySelector(`.${styles.readOnlyVote}`);
    expect(readOnlyVote).not.toBeNull();

    const voteIcon = readOnlyVote!.querySelector('svg');
    expect(voteIcon).not.toBeNull();
    expect(voteIcon!.querySelectorAll(`rect.${styles.fingerRaised}`)).toHaveLength(4);
    expect(voteIcon!.querySelectorAll(`rect.${styles.fingerPartialBase}`)).toHaveLength(1);
    expect(voteIcon!.querySelectorAll(`rect.${styles.fingerFolded}`)).toHaveLength(1);
    const partialDivider = voteIcon!.querySelector(`line.${styles.fingerPartialDivider}`) as SVGLineElement | null;
    expect(partialDivider).not.toBeNull();
    expect(partialDivider?.getAttribute('x1')).toBe('39');
    expect(partialDivider?.getAttribute('x2')).toBe('44');
  });

  it('renders half-step confidence votes with the next finger partially raised', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE_WITH_HALF_CONFIDENCE);

    renderPiReviewTab([DEFAULT_TEAMS[0]], 'readout');

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByText('2.5')).toBeInTheDocument();
    const voteIcon = alphaSection.querySelector(`.${styles.readOnlyVote} svg`);
    expect(voteIcon).not.toBeNull();
    expect(voteIcon!.querySelectorAll(`rect.${styles.fingerRaised}`)).toHaveLength(3);
    expect(voteIcon!.querySelectorAll(`rect.${styles.fingerPartialBase}`)).toHaveLength(1);
    const partialDivider = voteIcon!.querySelector(`line.${styles.fingerPartialDivider}`) as SVGLineElement | null;
    expect(partialDivider).not.toBeNull();
    expect(partialDivider?.getAttribute('x1')).toBe('32');
    expect(partialDivider?.getAttribute('x2')).toBe('37');
  });

  it('loads the Toolbox-owned template locally before overwriting Confluence on save', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue({
      ...ALPHA_PAGE,
      body: {
        storage: {
          value: '<h1>Alpha planning notes</h1><table><tr><th>Unexpected table</th></tr></table>',
          representation: 'storage',
        },
      },
    });
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(await within(alphaSection).findByText(/No Confluence table was found/i)).toBeInTheDocument();
    expect(
      within(alphaSection).getByText(/load the toolbox pi review template locally before saving because this page does not contain a recognized pi review table yet/i),
    ).toBeInTheDocument();
    expect(within(alphaSection).getByRole('button', { name: /save to confluence/i })).toBeDisabled();

    fireEvent.click(within(alphaSection).getByRole('button', { name: /load toolbox pi review template locally/i }));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /start local draft/i }));

    expect(mockUpdateConfluencePage).not.toHaveBeenCalled();
    expect(within(alphaSection).getByText(/unsaved changes/i)).toBeInTheDocument();
    expect(within(alphaSection).getByLabelText(/feature for alpha team row 1/i)).toBeInTheDocument();
    expect(within(alphaSection).getByLabelText(/committed to pi\? for alpha team row 1/i)).toBeInTheDocument();
    fireEvent.change(
      within(alphaSection).getByLabelText(/feature for alpha team row 1/i),
      { target: { value: 'Drafted in Toolbox first' } },
    );
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() =>
      expect(mockUpdateConfluencePage).toHaveBeenCalledWith(
        expect.objectContaining({
          pageId: '12345',
          nextVersionNumber: 8,
          storageValue: expect.stringContaining('NodeToolbox PI Review'),
        }),
      ),
    );
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain('Drafted in Toolbox first');
  });

  it('keeps the resolved page ID visible when the Confluence fetch fails', async () => {
    mockFetchConfluencePageByReference.mockRejectedValue(
      new Error('Confluence GET page 12345 failed: Could not resolve the configured Confluence host.'),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(await within(alphaSection).findByText(/Could not resolve the configured Confluence host/i)).toBeInTheDocument();
    expect(within(alphaSection).getByText('12345')).toBeInTheDocument();
  });

  it('adds optional dev work and test support checkbox columns to the saved Toolbox table', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue({
      ...ALPHA_PAGE,
      body: {
        storage: {
          value: '<h1>Alpha planning notes</h1><table><tr><th>Unexpected table</th></tr></table>',
          representation: 'storage',
        },
      },
    });
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.click(await within(alphaSection).findByRole('button', { name: /load toolbox pi review template locally/i }));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /start local draft/i }));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add dev work/i }));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add test support/i }));
    fireEvent.click(within(alphaSection).getByLabelText(/dev work for alpha team row 1/i));
    fireEvent.click(within(alphaSection).getByLabelText(/test support for alpha team row 1/i));
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    const savedStorageValue = mockUpdateConfluencePage.mock.calls[0][0].storageValue;
    expect(savedStorageValue).toContain('<th>Dev Work</th>');
    expect(savedStorageValue).toContain('<th>Test Support</th>');
    expect(savedStorageValue).toContain('<td>Yes</td>');
  });

  it('saves a single hard-commit boundary line between PI Review rows', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add pi review row/i }));
    fireEvent.change(within(alphaSection).getByLabelText(/feature for alpha team row 2/i), {
      target: { value: 'Stretch goal feature' },
    });
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /set stretch goals line below/i })[0]);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    const savedStorageValue = mockUpdateConfluencePage.mock.calls[0][0].storageValue;
    expect(savedStorageValue).toContain('data-node-toolbox-pi-review-boundary="hard-commit"');
    expect(savedStorageValue).toContain('Hard commits above / Stretch goals below');
  });

  it('reorders rows so the commitment line can sit under the committed work', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...ALPHA_PAGE,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add pi review row/i }));
    fireEvent.change(within(alphaSection).getByLabelText(/feature for alpha team row 2/i), {
      target: { value: 'Committed feature' },
    });
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /move up/i })[1]);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /set stretch goals line below/i })[0]);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });

    const savedStorageValue = mockUpdateConfluencePage.mock.calls[0][0].storageValue;
    expect(savedStorageValue.indexOf('Committed feature')).toBeLessThan(savedStorageValue.indexOf('Hard commits above / Stretch goals below'));
    expect(savedStorageValue.indexOf('Hard commits above / Stretch goals below')).toBeLessThan(savedStorageValue.indexOf('Feature A'));
  });

  it('moves the commitment line with committed rows when a row crosses the boundary', async () => {
    const alphaPageWithBoundary = createAlphaPageWithExtraPiReviewRows(`
            <tr>
              <td>No</td>
              <td>P2</td>
              <td>Committed Feature</td>
              <td>5</td>
              <td>None</td>
              <td>Low</td>
              <td>Yes</td>
              <td>Committed note</td>
            </tr>
            <tr data-node-toolbox-pi-review-boundary="hard-commit">
              <td colspan="8">Hard commits above / Stretch goals below</td>
            </tr>
            <tr>
              <td>No</td>
              <td>P2</td>
              <td>Stretch Feature</td>
              <td>5</td>
              <td>None</td>
              <td>Low</td>
              <td></td>
              <td>Stretch note</td>
            </tr>`);
    mockFetchConfluencePageByReference.mockResolvedValue(alphaPageWithBoundary);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...alphaPageWithBoundary,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /move up/i })[2]);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });

    const savedStorageValue = mockUpdateConfluencePage.mock.calls[0][0].storageValue;
    expect(savedStorageValue.indexOf('Feature A')).toBeLessThan(savedStorageValue.indexOf('Stretch Feature'));
    expect(savedStorageValue.indexOf('Committed Feature')).toBeLessThan(savedStorageValue.indexOf('Hard commits above / Stretch goals below'));
  });

  it('retries the save with the latest Confluence version after a version conflict', async () => {
    mockFetchConfluencePageByReference
      .mockResolvedValueOnce(ALPHA_PAGE)
      .mockResolvedValueOnce({
        ...ALPHA_PAGE,
        version: { number: 19 },
      });
    mockUpdateConfluencePage
      .mockRejectedValueOnce(new Error('Version must be incremented on update. Current version is: 19'))
      .mockImplementationOnce((savePayload: { storageValue: string; nextVersionNumber: number }) =>
        Promise.resolve({
          ...ALPHA_PAGE,
          version: { number: savePayload.nextVersionNumber },
          body: {
            storage: {
              value: savePayload.storageValue,
              representation: 'storage',
            },
          },
        }),
      );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.change(within(alphaSection).getByLabelText(/notes for alpha team row 1/i), {
      target: { value: 'Retry after conflict' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(2);
    });
    expect(mockFetchConfluencePageByReference).toHaveBeenCalledTimes(2);
    expect(mockUpdateConfluencePage.mock.calls[1][0].nextVersionNumber).toBe(20);
    expect(mockUpdateConfluencePage.mock.calls[1][0].storageValue).toContain('Retry after conflict');
  });

  it('reloads an existing hard-commit boundary and keeps it on the next save', async () => {
    const alphaPageWithBoundary = createAlphaPageWithExtraPiReviewRows(`
            <tr data-node-toolbox-pi-review-boundary="hard-commit">
              <td colspan="8">Hard commits above / Stretch goals below</td>
            </tr>
            <tr>
              <td>No</td>
              <td>P2</td>
              <td>Stretch Feature</td>
              <td>5</td>
              <td>None</td>
              <td>Low</td>
              <td></td>
              <td>Stretch note</td>
            </tr>`);
    mockFetchConfluencePageByReference.mockResolvedValue(alphaPageWithBoundary);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...alphaPageWithBoundary,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByText(/hard commits above/i)).toBeInTheDocument();
    expect(within(alphaSection).getByText(/stretch goals line: after row 1/i)).toBeInTheDocument();

    enterEditMode(alphaSection);
    fireEvent.change(within(alphaSection).getByLabelText(/notes for alpha team row 2/i), {
      target: { value: 'Still below the line' },
    });
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).toContain(
      'data-node-toolbox-pi-review-boundary="hard-commit"',
    );
  });

  it('clears the hard-commit boundary when row removal leaves no valid between-row position', async () => {
    const alphaPageWithBoundary = createAlphaPageWithExtraPiReviewRows(`
            <tr data-node-toolbox-pi-review-boundary="hard-commit">
              <td colspan="8">Hard commits above / Stretch goals below</td>
            </tr>
            <tr>
              <td>No</td>
              <td>P2</td>
              <td>Stretch Feature</td>
              <td>5</td>
              <td>None</td>
              <td>Low</td>
              <td></td>
              <td>Stretch note</td>
            </tr>`);
    mockFetchConfluencePageByReference.mockResolvedValue(alphaPageWithBoundary);
    mockUpdateConfluencePage.mockImplementation((savePayload: { storageValue: string }) =>
      Promise.resolve({
        ...alphaPageWithBoundary,
        version: { number: 8 },
        body: {
          storage: {
            value: savePayload.storageValue,
            representation: 'storage',
          },
        },
      }),
    );

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    enterEditMode(alphaSection);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /remove/i })[0]);
    fireEvent.click(within(alphaSection).getByRole('button', { name: /save to confluence/i }));

    await waitFor(() => {
      expect(mockUpdateConfluencePage).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateConfluencePage.mock.calls[0][0].storageValue).not.toContain(
      'data-node-toolbox-pi-review-boundary="hard-commit"',
    );
  });
});
