// PiReviewTab.test.tsx — Unit tests for the multi-team Confluence-backed PI Review ART tab.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { ToastProvider } from '../../components/Toast/ToastProvider.tsx';
import type { ArtTeam } from './hooks/useArtData.ts';
import { useArtCapacityStore } from './hooks/useArtCapacityStore.ts';
import { writePiReviewCapacitySummary } from './piReviewTable.ts';

const { mockFetchConfluencePageByReference, mockResolveConfluencePageIdFromReference, mockUpdateConfluencePage } = vi.hoisted(() => ({
  mockFetchConfluencePageByReference: vi.fn(),
  mockResolveConfluencePageIdFromReference: vi.fn(),
  mockUpdateConfluencePage: vi.fn(),
}));

vi.mock('../../services/confluenceApi.ts', () => ({
  fetchConfluencePageByReference: mockFetchConfluencePageByReference,
  resolveConfluencePageIdFromReference: mockResolveConfluencePageIdFromReference,
  updateConfluencePage: mockUpdateConfluencePage,
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

function renderPiReviewTab(teams: ArtTeam[] = DEFAULT_TEAMS) {
  return render(
    <ToastProvider>
      <PiReviewTab selectedPiName="PI 26.3" teams={teams} />
    </ToastProvider>,
  );
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
    useArtCapacityStore.setState({ teamConfigs: {} });
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

  it('auto-loads one Confluence page per configured team and renders both sections', async () => {
    mockFetchConfluencePageByReference.mockImplementation((pageReference: string) => {
      if (pageReference.includes('12345')) {
        return Promise.resolve(ALPHA_PAGE);
      }
      return Promise.resolve(BETA_PAGE);
    });

    renderPiReviewTab();

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(alphaSection).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /beta team pi review/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Feature A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Feature B')).toBeInTheDocument();
    expect(within(alphaSection).getByText(/committed points: 8/i)).toBeInTheDocument();
    expect(mockFetchConfluencePageByReference).toHaveBeenCalledTimes(2);
  });

  it('saves edited rows and confidence votes back to the selected team page', async () => {
    useArtCapacityStore.setState({
      teamConfigs: {
        'team-1': {
          startDate: '2026-05-18',
          endDate: '2026-05-22',
          rows: [
            { id: 'capacity-dev', role: 'Dev', memberCount: 2, capacityPercentage: 100, totalPtoDays: 0 },
          ],
        },
      },
    });
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

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    fireEvent.change(
      within(alphaSection).getByLabelText(/notes for alpha team row 1/i),
      { target: { value: 'Ready to commit' } },
    );
    fireEvent.change(
      within(alphaSection).getByLabelText(/notes for alpha team confidence row 1/i),
      { target: { value: 'Still confident' } },
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
    expect(savePayload.storageValue).toContain('Still confident');
  });

  it('renders the current team capacity above the PI Review table', async () => {
    useArtCapacityStore.setState({
      teamConfigs: {
        'team-1': {
          startDate: '2026-05-18',
          endDate: '2026-05-22',
          rows: [
            { id: 'capacity-dev', role: 'Dev', memberCount: 2, capacityPercentage: 100, totalPtoDays: 0 },
            { id: 'capacity-qe', role: 'QE', memberCount: 1, capacityPercentage: 50, totalPtoDays: 0 },
          ],
        },
      },
    });
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(within(alphaSection).getByRole('heading', { name: /team capacity/i })).toBeInTheDocument();
    expect(within(alphaSection).getByText('Alpha Team Capacity')).toBeInTheDocument();
    expect(within(alphaSection).getByText('12.5')).toBeInTheDocument();
    expect(within(alphaSection).getByText('Dev: 10 pts')).toBeInTheDocument();
    expect(within(alphaSection).getByText('QE: 2.5 pts')).toBeInTheDocument();
  });

  it('falls back to the saved Confluence capacity snapshot when local capacity is incomplete', async () => {
    useArtCapacityStore.setState({
      teamConfigs: {
        'team-1': {
          startDate: '',
          endDate: '',
          rows: [
            { id: 'capacity-dev', role: 'Dev', memberCount: 2, capacityPercentage: 100, totalPtoDays: 0 },
          ],
        },
      },
    });
    const alphaPageWithSavedCapacity = {
      ...ALPHA_PAGE,
      body: {
        storage: {
          value: writePiReviewCapacitySummary(ALPHA_PAGE.body.storage.value, {
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
          }),
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

  it('renders fist-of-five hand-image options for each confidence vote row', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue(ALPHA_PAGE);

    renderPiReviewTab([DEFAULT_TEAMS[0]]);

    const alphaSection = await screen.findByRole('region', { name: /alpha team pi review/i });
    expect(
      within(alphaSection).getByRole('button', {
        name: /set fist of five vote to 5 for alpha team confidence row 1/i,
      }),
    ).toBeInTheDocument();
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
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add pi review row/i }));
    fireEvent.change(within(alphaSection).getByLabelText(/feature for alpha team row 2/i), {
      target: { value: 'Stretch goal feature' },
    });
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /set commit line below/i })[0]);
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
    fireEvent.click(within(alphaSection).getByRole('button', { name: /add pi review row/i }));
    fireEvent.change(within(alphaSection).getByLabelText(/feature for alpha team row 2/i), {
      target: { value: 'Committed feature' },
    });
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /move up/i })[1]);
    fireEvent.click(within(alphaSection).getAllByRole('button', { name: /set commit line below/i })[0]);
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
    expect(within(alphaSection).getByText(/commitment line: after row 1/i)).toBeInTheDocument();

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
