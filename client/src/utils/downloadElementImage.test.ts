// downloadElementImage.test.ts — Unit tests for the shared PNG export helper used by report downloads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHtml2Canvas,
  mockCreateObjectUrl,
  mockDownloadClick,
  mockRevokeObjectUrl,
} = vi.hoisted(() => ({
  mockHtml2Canvas: vi.fn(),
  mockCreateObjectUrl: vi.fn(),
  mockDownloadClick: vi.fn(),
  mockRevokeObjectUrl: vi.fn(),
}));

vi.mock('html2canvas', () => ({
  default: mockHtml2Canvas,
}));

import { downloadElementImage } from './downloadElementImage.ts';

function createMockCanvas(width: number, height: number): HTMLCanvasElement {
  return {
    height,
    toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['panel'], { type: 'image/png' }))),
    width,
  } as unknown as HTMLCanvasElement;
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
  });

  afterEach(() => {
    vi.useRealTimers();
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
