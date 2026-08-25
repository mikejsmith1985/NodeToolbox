// downloadElementImage.test.ts — Unit tests for the shared PNG export helper used by report downloads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHtml2Canvas,
  mockClipboardWrite,
  mockClipboardItemConstructor,
  mockCreateObjectUrl,
  mockDownloadClick,
  mockRevokeObjectUrl,
} = vi.hoisted(() => ({
  mockHtml2Canvas: vi.fn(),
  mockClipboardWrite: vi.fn(),
  mockClipboardItemConstructor: vi.fn(),
  mockCreateObjectUrl: vi.fn(),
  mockDownloadClick: vi.fn(),
  mockRevokeObjectUrl: vi.fn(),
}));

vi.mock('html2canvas', () => ({
  default: mockHtml2Canvas,
}));

import {
  copyElementImageToClipboard,
  copyElementReportToClipboard,
  downloadElementImage,
  readExportRenderScale,
  renameForBlobType,
} from './downloadElementImage.ts';

function createMockCanvas(width: number, height: number): HTMLCanvasElement {
  return {
    height,
    toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['panel'], { type: 'image/png' }))),
    width,
  } as unknown as HTMLCanvasElement;
}

function installClipboardStubs(): void {
  class MockClipboardItem {
    constructor(clipboardItems: Record<string, Blob>) {
      mockClipboardItemConstructor(clipboardItems);
    }
  }

  vi.stubGlobal('ClipboardItem', MockClipboardItem);
  vi.stubGlobal('navigator', {
    clipboard: {
      write: mockClipboardWrite,
    },
  });
}

describe('downloadElementImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mockDownloadClick);
    mockCreateObjectUrl.mockReturnValue('blob:shared-export');
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (frameRequestCallback: FrameRequestCallback) => {
      frameRequestCallback(0);
      return 1;
    });
    vi.stubGlobal('URL', {
      createObjectURL: mockCreateObjectUrl,
      revokeObjectURL: mockRevokeObjectUrl,
    });
    installClipboardStubs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('copyElementImageToClipboard', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubGlobal('requestAnimationFrame', (frameRequestCallback: FrameRequestCallback) => {
        frameRequestCallback(0);
        return 1;
      });
      installClipboardStubs();
    });

    it('copies the captured PNG image to the clipboard when ClipboardItem is available', async () => {
      mockHtml2Canvas.mockResolvedValue(createMockCanvas(1400, 900));
      const panelElement = document.createElement('section');
      panelElement.textContent = 'Snapshot report';
      document.body.appendChild(panelElement);

      await copyElementImageToClipboard(panelElement, 'The export section is no longer available.');

      expect(mockClipboardItemConstructor).toHaveBeenCalledTimes(1);
      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
    });

    it('throws a clear error when clipboard image copy is not supported', async () => {
      mockHtml2Canvas.mockResolvedValue(createMockCanvas(1400, 900));
      vi.stubGlobal('ClipboardItem', undefined);

      const panelElement = document.createElement('section');
      panelElement.textContent = 'Snapshot report';
      document.body.appendChild(panelElement);

      await expect(
        copyElementImageToClipboard(panelElement, 'The export section is no longer available.'),
      ).rejects.toThrow('Image copy is not supported in this browser.');
    });
  });

  describe('copyElementReportToClipboard', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubGlobal('requestAnimationFrame', (frameRequestCallback: FrameRequestCallback) => {
        frameRequestCallback(0);
        return 1;
      });
      installClipboardStubs();
    });

    it('writes both an HTML table and the PNG image to the clipboard in one copy', async () => {
      mockHtml2Canvas.mockResolvedValue(createMockCanvas(1400, 900));
      const panelElement = document.createElement('section');
      panelElement.textContent = 'Release notes';
      document.body.appendChild(panelElement);

      await copyElementReportToClipboard(
        panelElement,
        '<div><h2>Transformers 06/23/2026 Release Notes</h2><table></table></div>',
        'The release notes section is no longer available to copy.',
      );

      expect(mockClipboardItemConstructor).toHaveBeenCalledTimes(1);
      const clipboardPayload = mockClipboardItemConstructor.mock.calls[0][0] as Record<string, Blob>;
      expect(Object.keys(clipboardPayload)).toEqual(['text/html', 'image/png']);
      expect(clipboardPayload['text/html'].type).toBe('text/html');
      expect(clipboardPayload['image/png'].type).toBe('image/png');
      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
    });
  });

  it('throws the caller-provided message when the export element is no longer connected', async () => {
    const detachedPanelElement = document.createElement('section');

    await expect(
      downloadElementImage(detachedPanelElement, 'detached.png', 'The export section is no longer available.'),
    ).rejects.toThrow('The export section is no longer available.');
  });

  it('captures a cloned export panel, downloads the PNG, and cleans up the blob URL later', async () => {
    mockHtml2Canvas.mockResolvedValue(createMockCanvas(1600, 2200));

    const panelElement = document.createElement('section');
    panelElement.style.backgroundColor = 'rgb(17, 24, 39)';
    panelElement.innerHTML = `
      <div data-export-exclude="true">toolbar</div>
      <div data-export-expand="true" style="overflow:auto;max-height:240px;">
        <table><tbody><tr><td>Feature A</td></tr></tbody></table>
      </div>
    `;
    document.body.appendChild(panelElement);

    await downloadElementImage(panelElement, 'shared-export.png', 'The export section is no longer available.');

    const exportedClone = mockHtml2Canvas.mock.calls[0][0] as HTMLElement;
    expect(exportedClone.querySelector('[data-export-exclude="true"]')).toBeNull();
    expect(exportedClone.getAttribute('data-node-toolbox-export-clone')).toBe('true');
    expect(exportedClone.style.backgroundColor).toBe('rgb(17, 24, 39)');
    expect((exportedClone.querySelector('[data-export-expand="true"]') as HTMLElement).style.overflow).toBe('visible');
    expect(mockCreateObjectUrl).toHaveBeenCalledTimes(1);
    expect(mockDownloadClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="shared-export.png"]')).toBeInTheDocument();
    expect(document.querySelector('[data-node-toolbox-export-host="true"]')).toBeNull();
    expect(mockRevokeObjectUrl).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(mockRevokeObjectUrl).toHaveBeenCalledWith('blob:shared-export');
    expect(document.querySelector('a[download="shared-export.png"]')).toBeNull();
  });
});

describe('readExportRenderScale — an export nobody can attach is not an export', () => {
  it('keeps the crisp scale for a panel small enough to afford it', () => {
    // 1200 x 800 at scale 3 is under three megapixels; nothing needs to change.
    expect(readExportRenderScale(1200, 800)).toBe(3);
  });

  it('drops the scale for a full board, which at scale 3 lands past twenty megabytes', () => {
    // 2500 x 3000 at scale 3 is sixty-seven megapixels of LOSSLESS PNG — too big for a GitHub
    // comment, too big for the web UI, too big to email. Beautiful and unusable.
    const scale = readExportRenderScale(2500, 3000);

    expect(scale).toBeLessThan(3);
    expect(2500 * 3000 * scale * scale).toBeLessThanOrEqual(24_000_000);
  });

  it('never scales UP, so this can only ever make an export smaller', () => {
    expect(readExportRenderScale(10, 10)).toBe(3);
    expect(readExportRenderScale(10, 10, 2)).toBe(2);
  });

  it('never drops below 1 — an export nobody can READ is not the smaller problem', () => {
    expect(readExportRenderScale(20000, 20000)).toBe(1);
  });

  it('treats a zero-sized element as one pixel rather than dividing by nothing', () => {
    expect(Number.isFinite(readExportRenderScale(0, 0))).toBe(true);
  });
});

describe('renameForBlobType', () => {
  it('leaves a PNG name alone', () => {
    expect(renameForBlobType('roll-up-board.png', 'image/png')).toBe('roll-up-board.png');
  });

  it('renames to .jpg when the encoder fell back to JPEG', () => {
    // A JPEG saved as .png opens in some viewers and not others, and the ones it fails in report a
    // corrupt file rather than a renamed one.
    expect(renameForBlobType('roll-up-board.png', 'image/jpeg')).toBe('roll-up-board.jpg');
  });

  it('adds the extension when the name had none', () => {
    expect(renameForBlobType('roll-up-board', 'image/png')).toBe('roll-up-board.png');
  });

  it('does not mangle a name containing a dot that is not an extension', () => {
    expect(renameForBlobType('board v1.2', 'image/png')).toBe('board v1.2.png');
  });
});
