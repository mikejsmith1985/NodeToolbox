// piReviewPdf.ts — Captures a clean PI Review panel snapshot and downloads it as a multi-page PDF.

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PDF_MARGIN_POINTS = 24;
const EXPORT_RENDER_SCALE = 2;
const PDF_IMAGE_FORMAT = 'PNG';
const PDF_PAGE_FORMAT = 'a4';

function createDetachedExportHost(): HTMLDivElement {
  const detachedExportHost = document.createElement('div');
  detachedExportHost.setAttribute('data-node-toolbox-pdf-export', 'true');
  Object.assign(detachedExportHost.style, {
    position: 'fixed',
    top: '0',
    left: '-10000px',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  return detachedExportHost;
}

function createExportPanelClone(panelElement: HTMLElement): HTMLElement {
  const clonedPanelElement = panelElement.cloneNode(true) as HTMLElement;
  const exportWidthPixels = Math.max(panelElement.scrollWidth, panelElement.clientWidth);
  clonedPanelElement.style.width = `${exportWidthPixels}px`;
  clonedPanelElement.style.maxWidth = 'none';

  clonedPanelElement.querySelectorAll('[data-pdf-exclude="true"]').forEach((excludedElement) => excludedElement.remove());
  clonedPanelElement.querySelectorAll('[data-pdf-expand="true"]').forEach((expandableElement) => {
    const expandableHtmlElement = expandableElement as HTMLElement;
    expandableHtmlElement.style.overflow = 'visible';
    expandableHtmlElement.style.maxHeight = 'none';
  });

  return clonedPanelElement;
}

async function waitForExportLayout(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

async function capturePanelCanvas(panelElement: HTMLElement): Promise<HTMLCanvasElement> {
  const detachedExportHost = createDetachedExportHost();
  const clonedPanelElement = createExportPanelClone(panelElement);
  const panelBackgroundColor = getComputedStyle(panelElement).backgroundColor || '#ffffff';

  detachedExportHost.appendChild(clonedPanelElement);
  document.body.appendChild(detachedExportHost);

  try {
    await waitForExportLayout();
    return await html2canvas(clonedPanelElement, {
      backgroundColor: panelBackgroundColor,
      height: clonedPanelElement.scrollHeight,
      logging: false,
      scale: EXPORT_RENDER_SCALE,
      useCORS: true,
      width: clonedPanelElement.scrollWidth,
      windowHeight: clonedPanelElement.scrollHeight,
      windowWidth: clonedPanelElement.scrollWidth,
    });
  } finally {
    detachedExportHost.remove();
  }
}

function appendCanvasToPdf(pdfDocument: jsPDF, panelCanvas: HTMLCanvasElement): void {
  const pageWidthPoints = pdfDocument.internal.pageSize.getWidth();
  const pageHeightPoints = pdfDocument.internal.pageSize.getHeight();
  const availableWidthPoints = pageWidthPoints - PDF_MARGIN_POINTS * 2;
  const visiblePageHeightPoints = pageHeightPoints - PDF_MARGIN_POINTS;
  const scaledCanvasHeightPoints = (panelCanvas.height * availableWidthPoints) / panelCanvas.width;
  const canvasImageData = panelCanvas.toDataURL('image/png');
  let remainingHeightPoints = scaledCanvasHeightPoints;
  let imageOffsetPoints = 0;

  while (remainingHeightPoints > 0) {
    pdfDocument.addImage(
      canvasImageData,
      PDF_IMAGE_FORMAT,
      PDF_MARGIN_POINTS,
      PDF_MARGIN_POINTS - imageOffsetPoints,
      availableWidthPoints,
      scaledCanvasHeightPoints,
      undefined,
      'FAST',
    );

    remainingHeightPoints -= visiblePageHeightPoints;
    imageOffsetPoints += visiblePageHeightPoints;
    if (remainingHeightPoints > 0) {
      pdfDocument.addPage();
    }
  }
}

/** Downloads the current PI Review panel as a screenshot-style PDF for sharing outside Toolbox. */
export async function downloadPiReviewPanelPdf(panelElement: HTMLElement, fileName: string): Promise<void> {
  if (!panelElement.isConnected) {
    throw new Error('The PI Review panel is no longer available to export.');
  }

  const panelCanvas = await capturePanelCanvas(panelElement);
  const pdfDocument = new jsPDF({
    compress: true,
    format: PDF_PAGE_FORMAT,
    orientation: 'landscape',
    unit: 'pt',
  });

  appendCanvasToPdf(pdfDocument, panelCanvas);
  pdfDocument.save(fileName);
}
