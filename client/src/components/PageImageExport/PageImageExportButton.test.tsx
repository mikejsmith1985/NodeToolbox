// PageImageExportButton.test.tsx — The global page PNG export: file naming, capture wiring, and the
// honest failure paths (no export root / capture error).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloadElementImage } = vi.hoisted(() => ({ mockDownloadElementImage: vi.fn() }));

vi.mock('../../utils/downloadElementImage.ts', () => ({
  downloadElementImage: mockDownloadElementImage,
}));

import { ToastProvider } from '../Toast/ToastProvider.tsx';
import {
  buildPageExportFileName,
  PAGE_EXPORT_ROOT_ATTRIBUTE,
  PageImageExportButton,
} from './PageImageExportButton.tsx';

const EXPORT_TIME = new Date('2026-07-31T15:30:00.000Z');

function renderButton(initialRoute = '/agile-hub?space=train') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <ToastProvider>
        <PageImageExportButton />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** Adds the routed-content container App.tsx normally provides. */
function attachExportRoot(): HTMLElement {
  const exportRoot = document.createElement('div');
  exportRoot.setAttribute(PAGE_EXPORT_ROOT_ATTRIBUTE, 'true');
  document.body.appendChild(exportRoot);
  return exportRoot;
}

beforeEach(() => {
  mockDownloadElementImage.mockResolvedValue(undefined);
});

afterEach(() => {
  document.querySelectorAll(`[${PAGE_EXPORT_ROOT_ATTRIBUTE}]`).forEach((element) => element.remove());
  vi.clearAllMocks();
});

describe('buildPageExportFileName', () => {
  it('names the file after the route, the hub space/tab, and the date', () => {
    expect(buildPageExportFileName('/agile-hub', '?space=train&artTab=readiness', EXPORT_TIME))
      .toBe('toolbox-agile-hub-train-2026-07-31.png');
    expect(buildPageExportFileName('/jira-create', '?tab=templates', EXPORT_TIME))
      .toBe('toolbox-jira-create-templates-2026-07-31.png');
  });

  it('names the home route explicitly', () => {
    expect(buildPageExportFileName('/', '', EXPORT_TIME)).toBe('toolbox-home-2026-07-31.png');
  });
});

describe('PageImageExportButton', () => {
  it('captures the page export root with a route-derived file name', async () => {
    const exportRoot = attachExportRoot();
    renderButton('/agile-hub?space=train');

    fireEvent.click(screen.getByRole('button', { name: /export png/i }));

    await waitFor(() => expect(mockDownloadElementImage).toHaveBeenCalledTimes(1));
    const [capturedElement, fileName] = mockDownloadElementImage.mock.calls[0];
    expect(capturedElement).toBe(exportRoot);
    expect(fileName).toMatch(/^toolbox-agile-hub-train-\d{4}-\d{2}-\d{2}\.png$/);
    expect(await screen.findByText(/page exported as png/i)).toBeInTheDocument();
  });

  it('shows an honest error (and captures nothing) when the page root is missing', async () => {
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /export png/i }));

    expect(await screen.findByText(/not ready to export/i)).toBeInTheDocument();
    expect(mockDownloadElementImage).not.toHaveBeenCalled();
  });

  it('surfaces a capture failure as a toast and re-enables the button', async () => {
    attachExportRoot();
    mockDownloadElementImage.mockRejectedValueOnce(new Error('The PNG image could not be generated.'));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /export png/i }));

    expect(await screen.findByText(/could not be generated/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /export png/i })).toBeEnabled());
  });
});
