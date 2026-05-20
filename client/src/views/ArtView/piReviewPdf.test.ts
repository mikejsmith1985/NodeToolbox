// piReviewPdf.test.ts — Unit tests for screenshot-style PI Review PDF export assembly.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHtml2Canvas,
  mockJsPdfConstructor,
  mockPdfAddImage,
  mockPdfAddPage,
  mockPdfSave,
} = vi.hoisted(() => ({
  mockHtml2Canvas: vi.fn(),
  mockJsPdfConstructor: vi.fn(),
  mockPdfAddImage: vi.fn(),
  mockPdfAddPage: vi.fn(),
  mockPdfSave: vi.fn(),
}));

vi.mock('html2canvas', () => ({
  default: mockHtml2Canvas,
}));

vi.mock('jspdf', () => ({
  jsPDF: mockJsPdfConstructor,
}));

import { downloadPiReviewPanelPdf } from './piReviewPdf.ts';

function createMockCanvas(width: number, height: number): HTMLCanvasElement {
  return {
    height,
    toDataURL: vi.fn().mockReturnValue('data:image/png;base64,panel'),
    width,
  } as unknown as HTMLCanvasElement;
}

describe('downloadPiReviewPanelPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJsPdfConstructor.mockImplementation(
      function MockPdfDocument() {
        return {
          addImage: mockPdfAddImage,
          addPage: mockPdfAddPage,
          internal: {
            pageSize: {
              getHeight: () => 595.28,
              getWidth: () => 841.89,
            },
          },
          save: mockPdfSave,
        };
      },
    );
  });

  it('captures a cloned panel without export-excluded controls and saves the PDF', async () => {
    mockHtml2Canvas.mockResolvedValue(createMockCanvas(1200, 1800));

    const panelElement = document.createElement('section');
    panelElement.innerHTML = `
      <div data-pdf-exclude="true">toolbar</div>
      <div data-pdf-expand="true" style="overflow:auto;max-height:240px;">
        <table><tbody><tr><td>Feature A</td></tr></tbody></table>
      </div>
    `;
    document.body.appendChild(panelElement);

    await downloadPiReviewPanelPdf(panelElement, 'alpha-team.pdf');

    const exportedClone = mockHtml2Canvas.mock.calls[0][0] as HTMLElement;
    expect(exportedClone.querySelector('[data-pdf-exclude="true"]')).toBeNull();
    expect((exportedClone.querySelector('[data-pdf-expand="true"]') as HTMLElement).style.overflow).toBe('visible');
    expect(mockPdfAddImage).toHaveBeenCalled();
    expect(mockPdfSave).toHaveBeenCalledWith('alpha-team.pdf');
    expect(document.querySelector('[data-node-toolbox-pdf-export="true"]')).toBeNull();
  });

  it('adds extra PDF pages when the captured panel is taller than one sheet', async () => {
    mockHtml2Canvas.mockResolvedValue(createMockCanvas(1200, 4800));

    const panelElement = document.createElement('section');
    panelElement.textContent = 'Very tall PI Review panel';
    document.body.appendChild(panelElement);

    await downloadPiReviewPanelPdf(panelElement, 'tall-panel.pdf');

    expect(mockPdfAddImage.mock.calls.length).toBeGreaterThan(1);
    expect(mockPdfAddPage).toHaveBeenCalledTimes(mockPdfAddImage.mock.calls.length - 1);
  });
});
