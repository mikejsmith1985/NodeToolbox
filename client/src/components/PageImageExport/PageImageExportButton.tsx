// PageImageExportButton.tsx — sits in the app's top bar and downloads the CURRENT page's routed
// content as a high-resolution PNG, so any Toolbox screen can be shared in email or chat with one
// click. Capture itself is the existing downloadElementImage engine (html2canvas, export-exclude/
// expand attributes, modern-color fallbacks) — this component only finds the page root and names
// the file after the route.

import { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { downloadElementImage } from '../../utils/downloadElementImage.ts';
import { useToast } from '../Toast/ToastContext.ts';
import styles from './PageImageExport.module.css';

/** The attribute App.tsx stamps on the routed-content container this button captures. */
export const PAGE_EXPORT_ROOT_ATTRIBUTE = 'data-page-export-root';

const HOME_FILE_SEGMENT = 'home';
const EXPORT_UNAVAILABLE_MESSAGE = 'This page is not ready to export yet — try again in a moment.';
/** Query params worth reflecting in the file name (which hub space / tab the capture shows). */
const FILE_NAME_QUERY_PARAMS = ['space', 'tab'] as const;

/** Lowercases a path/param segment into a safe file-name fragment. */
function toFileNameSegment(rawSegment: string): string {
  return rawSegment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Builds the export file name from the current route: `toolbox-<page>[-<space/tab>]-<date>.png`.
 * The clock is injected so the name is unit-testable.
 */
export function buildPageExportFileName(pathname: string, search: string, exportedAt: Date): string {
  const pathSegment = toFileNameSegment(pathname) || HOME_FILE_SEGMENT;
  const queryParams = new URLSearchParams(search);
  const contextSegments = FILE_NAME_QUERY_PARAMS
    .map((paramName) => toFileNameSegment(queryParams.get(paramName) ?? ''))
    .filter((segment) => segment !== '');
  const dateSegment = exportedAt.toISOString().slice(0, 10);
  return ['toolbox', pathSegment, ...contextSegments, dateSegment].join('-') + '.png';
}

/** Finds the routed page content container the export captures. */
function findPageExportRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${PAGE_EXPORT_ROOT_ATTRIBUTE}="true"]`);
}

/** Top-bar button that downloads the current Toolbox page as a shareable PNG. */
export function PageImageExportButton() {
  const [isExporting, setIsExporting] = useState(false);
  const location = useLocation();
  const { showToast } = useToast();

  async function handleExportPage() {
    const pageExportRoot = findPageExportRoot();
    if (!pageExportRoot) {
      showToast(EXPORT_UNAVAILABLE_MESSAGE, 'error');
      return;
    }

    setIsExporting(true);
    try {
      await downloadElementImage(
        pageExportRoot,
        buildPageExportFileName(location.pathname, location.search, new Date()),
        EXPORT_UNAVAILABLE_MESSAGE,
      );
      showToast('Page exported as PNG.', 'success');
    } catch (exportError) {
      showToast(exportError instanceof Error ? exportError.message : 'The page export failed.', 'error');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <button
      className={styles.pageExportButton}
      disabled={isExporting}
      onClick={() => void handleExportPage()}
      title="Download this page as a PNG image to share"
      type="button"
    >
      {isExporting ? 'Exporting…' : '📸 Export PNG'}
    </button>
  );
}
