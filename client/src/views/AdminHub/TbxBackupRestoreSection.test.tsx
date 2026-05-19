// TbxBackupRestoreSection.test.tsx — Tests for the durable settings Backup / Restore section.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../../components/Toast/ToastProvider.tsx';
import TbxBackupRestoreSection from './TbxBackupRestoreSection';

function renderTbxBackupRestoreSection() {
  return render(
    <ToastProvider>
      <TbxBackupRestoreSection />
    </ToastProvider>,
  );
}

describe('TbxBackupRestoreSection', () => {
  beforeEach(() => {
    localStorage.clear();
    // Suppress URL.createObjectURL not available in jsdom.
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the Backup / Restore Settings heading', () => {
    renderTbxBackupRestoreSection();
    expect(
      screen.getByRole('heading', { name: /backup.*restore settings/i }),
    ).toBeInTheDocument();
  });

  it('renders the Export Settings button', () => {
    renderTbxBackupRestoreSection();
    expect(screen.getByRole('button', { name: /export settings/i })).toBeInTheDocument();
  });

  it('renders the Import Settings button', () => {
    renderTbxBackupRestoreSection();
    expect(screen.getByRole('button', { name: /import settings/i })).toBeInTheDocument();
  });

  it('renders the Reset All Data button', () => {
    renderTbxBackupRestoreSection();
    expect(screen.getByRole('button', { name: /reset all data/i })).toBeInTheDocument();
  });

  it('does not clear localStorage if the user cancels the Reset All Data confirmation', () => {
    localStorage.setItem('tbxSomeSetting', 'value');
    renderTbxBackupRestoreSection();

    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(localStorage.getItem('tbxSomeSetting')).toBe('value');
  });

  it('clears durable settings keys when Reset All Data is confirmed', () => {
    localStorage.setItem('tbxSomeSetting', 'value');
    localStorage.setItem('ntbx-crg-templates', '{"template":"chg"}');
    localStorage.setItem('nodetoolbox-art-teams', '[{"name":"Alpha Team"}]');
    localStorage.setItem('ntbx-relay-return-route', '/snow-hub');
    localStorage.setItem('otherKey', 'other');
    // Use Object.defineProperty to stub location.reload in jsdom.
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });
    renderTbxBackupRestoreSection();
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset all data$/i }));
    expect(localStorage.getItem('tbxSomeSetting')).toBeNull();
    expect(localStorage.getItem('ntbx-crg-templates')).toBeNull();
    expect(localStorage.getItem('nodetoolbox-art-teams')).toBeNull();
    // Transient browser state and unrelated keys must not be removed.
    expect(localStorage.getItem('ntbx-relay-return-route')).toBe('/snow-hub');
    expect(localStorage.getItem('otherKey')).toBe('other');
  });

  it('Export Settings triggers a download anchor click', () => {
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreateElement(tag);
      if (tag === 'a') {
        (element as HTMLAnchorElement).click = clickSpy;
      }
      return element;
    });
    renderTbxBackupRestoreSection();
    fireEvent.click(screen.getByRole('button', { name: /export settings/i }));
    expect(clickSpy).toHaveBeenCalled();
  });
});

