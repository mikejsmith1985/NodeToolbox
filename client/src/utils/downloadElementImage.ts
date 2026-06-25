// downloadElementImage.ts — Captures a DOM section as a high-resolution PNG download.

import html2canvas from 'html2canvas';

import {
  applyExportColorFallbacks,
  createCanvasColorResolver,
  sanitizeColorValue,
} from './colorFunctionFallback.ts';

const IMAGE_EXPORT_RENDER_SCALE = 3;
const PNG_MIME_TYPE = 'image/png';
const EXPORT_HOST_ATTRIBUTE = 'data-node-toolbox-export-host';
const EXPORT_CLONE_ATTRIBUTE = 'data-node-toolbox-export-clone';
const DOWNLOAD_LINK_CLEANUP_DELAY_MS = 10_000;

function createCanvasBlob(panelCanvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    panelCanvas.toBlob((imageBlob) => {
      if (imageBlob) {
        resolve(imageBlob);
        return;
      }

      reject(new Error('The PNG image could not be generated.'));
    }, PNG_MIME_TYPE);
  });
}

function createDetachedExportHost(): HTMLDivElement {
  const detachedExportHost = document.createElement('div');
  detachedExportHost.setAttribute(EXPORT_HOST_ATTRIBUTE, 'true');
  Object.assign(detachedExportHost.style, {
    position: 'absolute',
    top: '0',
    left: '-10000px',
    zIndex: '-1',
    overflow: 'visible',
    pointerEvents: 'none',
  });
  return detachedExportHost;
}

function createExportPanelClone(panelElement: HTMLElement, panelBackgroundColor: string): HTMLElement {
  const clonedPanelElement = panelElement.cloneNode(true) as HTMLElement;
  const exportWidthPixels = Math.max(panelElement.scrollWidth, panelElement.clientWidth);
  clonedPanelElement.setAttribute(EXPORT_CLONE_ATTRIBUTE, 'true');
  clonedPanelElement.style.width = `${exportWidthPixels}px`;
  clonedPanelElement.style.maxWidth = 'none';
  clonedPanelElement.style.backgroundColor = panelBackgroundColor;
  clonedPanelElement.style.transform = 'none';

  clonedPanelElement.querySelectorAll('[data-export-exclude="true"]').forEach((excludedElement) => excludedElement.remove());
  clonedPanelElement.querySelectorAll('[data-export-expand="true"]').forEach((expandableElement) => {
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

async function capturePanelCanvas(panelElement: HTMLElement, renderScale: number): Promise<HTMLCanvasElement> {
  // A single resolver caches every colour it flattens so repeated theme tints cost one canvas read.
  const resolveColorToken = createCanvasColorResolver();
  const detachedExportHost = createDetachedExportHost();
  // The panel background can itself be a color-mix()/color() value, so flatten it before html2canvas
  // receives it both as the host background and as the capture option.
  const rawPanelBackgroundColor = getComputedStyle(panelElement).backgroundColor || '#ffffff';
  const panelBackgroundColor = sanitizeColorValue(rawPanelBackgroundColor, resolveColorToken);
  const clonedPanelElement = createExportPanelClone(panelElement, panelBackgroundColor);
  detachedExportHost.style.backgroundColor = panelBackgroundColor;

  detachedExportHost.appendChild(clonedPanelElement);
  document.body.appendChild(detachedExportHost);

  try {
    await waitForExportLayout();
    // Replace every modern colour function in the live clone with an rgb() value html2canvas can parse.
    applyExportColorFallbacks(clonedPanelElement, resolveColorToken);
    return await html2canvas(clonedPanelElement, {
      backgroundColor: panelBackgroundColor,
      height: clonedPanelElement.scrollHeight,
      logging: false,
      scale: renderScale,
      useCORS: true,
      width: clonedPanelElement.scrollWidth,
      windowHeight: clonedPanelElement.scrollHeight,
      windowWidth: clonedPanelElement.scrollWidth,
    });
  } finally {
    detachedExportHost.remove();
  }
}

function scheduleDownloadCleanup(downloadLink: HTMLAnchorElement, imageObjectUrl: string): void {
  // Delay cleanup long enough for the browser to start reading the blob URL.
  window.setTimeout(() => {
    URL.revokeObjectURL(imageObjectUrl);
    downloadLink.remove();
  }, DOWNLOAD_LINK_CLEANUP_DELAY_MS);
}

async function writeImageBlobToClipboard(imageBlob: Blob): Promise<void> {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
    throw new Error('Image copy is not supported in this browser.');
  }

  if (typeof ClipboardItem === 'undefined') {
    throw new Error('Image copy is not supported in this browser.');
  }

  const clipboardItem = new ClipboardItem({
    [PNG_MIME_TYPE]: imageBlob,
  });
  await navigator.clipboard.write([clipboardItem]);
}

/** Downloads a rendered UI section as a readable PNG so exported reports match the in-app layout. */
export async function downloadElementImage(
  elementToExport: HTMLElement,
  fileName: string,
  unavailableMessage: string,
): Promise<void> {
  if (!elementToExport.isConnected) {
    throw new Error(unavailableMessage);
  }

  const panelCanvas = await capturePanelCanvas(elementToExport, IMAGE_EXPORT_RENDER_SCALE);
  const imageBlob = await createCanvasBlob(panelCanvas);
  const imageObjectUrl = URL.createObjectURL(imageBlob);
  const downloadLink = document.createElement('a');
  downloadLink.download = fileName;
  downloadLink.href = imageObjectUrl;
  downloadLink.style.display = 'none';
  document.body.appendChild(downloadLink);

  try {
    downloadLink.click();
  } finally {
    scheduleDownloadCleanup(downloadLink, imageObjectUrl);
  }
}

/** Copies a rendered UI section as a PNG image so it can be pasted into email and chat tools. */
export async function copyElementImageToClipboard(
  elementToExport: HTMLElement,
  unavailableMessage: string,
): Promise<void> {
  if (!elementToExport.isConnected) {
    throw new Error(unavailableMessage);
  }

  const panelCanvas = await capturePanelCanvas(elementToExport, IMAGE_EXPORT_RENDER_SCALE);
  const imageBlob = await createCanvasBlob(panelCanvas);
  await writeImageBlobToClipboard(imageBlob);
}
