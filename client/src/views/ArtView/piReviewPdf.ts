// piReviewPdf.ts — Captures a clean PI Review panel snapshot and downloads it as a PNG image.

import { downloadElementImage } from '../../utils/downloadElementImage.ts';

/** Downloads the current PI Review panel as a high-resolution PNG so the image stays readable when zoomed. */
export async function downloadPiReviewPanelImage(panelElement: HTMLElement, fileName: string): Promise<void> {
  await downloadElementImage(panelElement, fileName, 'The PI Review panel is no longer available to export.');
}
