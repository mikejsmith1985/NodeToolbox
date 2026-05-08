// TbxBackupRestoreSection.test.tsx — Tests for the tbx* Backup / Restore Settings section.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TbxBackupRestoreSection from './TbxBackupRestoreSection';

describe('TbxBackupRestoreSection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
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
    render(<TbxBackupRestoreSection />);
    expect(
      screen.getByRole('heading', { name: /backup.*restore settings/i }),
    ).toBeInTheDocument();
  });

  it('renders the Export Settings button', () => {
    render(<TbxBackupRestoreSection />);
    expect(screen.getByRole('button', { name: /export settings/i })).toBeInTheDocument();
  });

  it('renders the Import Settings button', () => {
    render(<TbxBackupRestoreSection />);
    expect(screen.getByRole('button', { name: /import settings/i })).toBeInTheDocument();
  });

  it('renders the Reset All Data button', () => {
    render(<TbxBackupRestoreSection />);
    expect(screen.getByRole('button', { name: /reset all data/i })).toBeInTheDocument();
  });

  it('does not clear localStorage if the user cancels the Reset All Data confirmation', () => {
    localStorage.setItem('tbxSomeSetting', 'value');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TbxBackupRestoreSection />);
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    expect(localStorage.getItem('tbxSomeSetting')).toBe('value');
  });

  it('clears tbx* localStorage keys when Reset All Data is confirmed', () => {
    localStorage.setItem('tbxSomeSetting', 'value');
    localStorage.setItem('otherKey', 'other');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Use Object.defineProperty to stub location.reload in jsdom.
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });
    render(<TbxBackupRestoreSection />);
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    expect(localStorage.getItem('tbxSomeSetting')).toBeNull();
    // Non-tbx keys must not be removed.
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
    render(<TbxBackupRestoreSection />);
    fireEvent.click(screen.getByRole('button', { name: /export settings/i }));
    expect(clickSpy).toHaveBeenCalled();
  });
});
