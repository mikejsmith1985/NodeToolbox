// downloadElementImage.ts — Captures a DOM section as a high-resolution PNG download.

import html2canvas from 'html2canvas';

import {
  applyExportColorFallbacks,
  createCanvasColorResolver,
  sanitizeColorValue,
} from './colorFunctionFallback.ts';

/**
 * The scale a SMALL panel is captured at — three device pixels per CSS pixel, for a crisp export.
 *
 * A ceiling rather than a constant now. At scale 3 a full-width board becomes roughly sixty-seven
 * megapixels of LOSSLESS PNG, which lands somewhere north of twenty megabytes: too big to attach to
 * a GitHub comment, too big to commit through the web UI, and too big to email. The picture was
 * beautiful and unusable.
 */
const IMAGE_EXPORT_RENDER_SCALE = 3;

/**
 * The most pixels an export will render, whatever its scale would have been.
 *
 * Twenty-four megapixels is about a 6000 x 4000 image — far past what any screen or document shows,
 * and comfortably inside what a PNG encoder produces at a sane file size. Below this budget nothing
 * changes; above it the scale drops just enough to fit.
 */
const MAX_EXPORT_PIXELS = 24_000_000;

/**
 * The size past which a PNG is re-encoded as a JPEG.
 *
 * GitHub refuses an image attachment over ten megabytes, which is the wall people actually hit. Eight
 * leaves room for the overhead of whatever is carrying it.
 */
const MAX_PNG_BYTES = 8_000_000;

/** JPEG quality for the re-encode: high enough that a screenshot of text stays readable. */
const JPEG_FALLBACK_QUALITY = 0.92;

const PNG_MIME_TYPE = 'image/png';
const JPEG_MIME_TYPE = 'image/jpeg';
const HTML_MIME_TYPE = 'text/html';
const EXPORT_HOST_ATTRIBUTE = 'data-node-toolbox-export-host';
const EXPORT_CLONE_ATTRIBUTE = 'data-node-toolbox-export-clone';
const DOWNLOAD_LINK_CLEANUP_DELAY_MS = 10_000;

/**
 * The scale an element can actually be captured at without blowing the pixel budget.
 *
 * Pure arithmetic, exported so the decision that quietly governs every export's file size is
 * testable rather than discovered by somebody failing to attach one. Never returns more than the
 * preferred scale — this only ever makes an export smaller — and never less than 1, because an
 * export nobody can read is not a smaller problem than one nobody can attach.
 */
export function readExportRenderScale(
  elementWidthPixels: number,
  elementHeightPixels: number,
  preferredScale = IMAGE_EXPORT_RENDER_SCALE,
  maxPixels = MAX_EXPORT_PIXELS,
): number {
  const cssPixels = Math.max(1, elementWidthPixels) * Math.max(1, elementHeightPixels);
  const scaleThatFits = Math.sqrt(maxPixels / cssPixels);
  return Math.max(1, Math.min(preferredScale, scaleThatFits));
}

/** Encodes a canvas at one mime type, or rejects saying which one failed. */
function encodeCanvas(panelCanvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    panelCanvas.toBlob((imageBlob) => {
      if (imageBlob) {
        resolve(imageBlob);
        return;
      }

      reject(new Error('The image could not be generated.'));
    }, mimeType, quality);
  });
}

/**
 * Encodes the capture, falling back to JPEG when the PNG is too big to be carried anywhere.
 *
 * PNG first, because it is lossless and most exports are small enough for it. A screenshot that is
 * too large to attach is not an export, so past the threshold a readable JPEG beats a perfect file
 * nobody can send.
 */
async function createCanvasBlob(panelCanvas: HTMLCanvasElement): Promise<Blob> {
  const pngBlob = await encodeCanvas(panelCanvas, PNG_MIME_TYPE);
  if (pngBlob.size <= MAX_PNG_BYTES) {
    return pngBlob;
  }

  return encodeCanvas(panelCanvas, JPEG_MIME_TYPE, JPEG_FALLBACK_QUALITY)
    // A refused JPEG encode leaves the oversized PNG, which is still better than no export at all.
    .catch(() => pngBlob);
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

/** The budgeted scale for one live element, measured the same way the capture measures it. */
function readExportRenderScaleFor(panelElement: HTMLElement): number {
  return readExportRenderScale(
    Math.max(panelElement.scrollWidth, panelElement.clientWidth),
    Math.max(panelElement.scrollHeight, panelElement.clientHeight),
  );
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

/**
 * Corrects a download filename to the format the encoder actually produced.
 *
 * A large capture falls back to JPEG, and a JPEG saved as `.png` opens in some viewers and not
 * others — and the ones it fails in report a corrupt file rather than a renamed one.
 */
export function renameForBlobType(fileName: string, blobMimeType: string): string {
  const targetExtension = blobMimeType === JPEG_MIME_TYPE ? '.jpg' : '.png';
  const withoutExtension = fileName.replace(/\.(png|jpe?g)$/i, '');
  return `${withoutExtension}${targetExtension}`;
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

  const panelCanvas = await capturePanelCanvas(elementToExport, readExportRenderScaleFor(elementToExport));
  const imageBlob = await createCanvasBlob(panelCanvas);
  const imageObjectUrl = URL.createObjectURL(imageBlob);
  const downloadLink = document.createElement('a');
  // The extension has to name what was actually encoded. A JPEG saved as .png opens in some viewers
  // and not others, and the ones it fails in report a corrupt file rather than a renamed one.
  downloadLink.download = renameForBlobType(fileName, imageBlob.type);
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

  const panelCanvas = await capturePanelCanvas(elementToExport, readExportRenderScaleFor(elementToExport));
  const imageBlob = await createCanvasBlob(panelCanvas);
  await writeImageBlobToClipboard(imageBlob);
}

/** Writes both an HTML representation and a PNG image to the clipboard in a single copy. */
async function writeReportToClipboard(imageBlob: Blob, htmlMarkup: string): Promise<void> {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
    throw new Error('Image copy is not supported in this browser.');
  }

  if (typeof ClipboardItem === 'undefined') {
    throw new Error('Image copy is not supported in this browser.');
  }

  // Order matters only as a hint; email clients prefer text/html, image-only tools take the PNG.
  const clipboardItem = new ClipboardItem({
    [HTML_MIME_TYPE]: new Blob([htmlMarkup], { type: HTML_MIME_TYPE }),
    [PNG_MIME_TYPE]: imageBlob,
  });
  await navigator.clipboard.write([clipboardItem]);
}

/**
 * Copies a rendered report to the clipboard as BOTH a reflowable HTML table and a PNG image.
 * Email clients (Outlook/Gmail) paste the readable native table; chat tools that only accept
 * images fall back to the high-resolution picture.
 */
export async function copyElementReportToClipboard(
  elementToExport: HTMLElement,
  htmlMarkup: string,
  unavailableMessage: string,
): Promise<void> {
  if (!elementToExport.isConnected) {
    throw new Error(unavailableMessage);
  }

  const panelCanvas = await capturePanelCanvas(elementToExport, readExportRenderScaleFor(elementToExport));
  const imageBlob = await createCanvasBlob(panelCanvas);
  await writeReportToClipboard(imageBlob, htmlMarkup);
}
