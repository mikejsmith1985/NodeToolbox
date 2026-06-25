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

import { copyElementImageToClipboard, copyElementReportToClipboard, downloadElementImage } from './downloadElementImage.ts';

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
