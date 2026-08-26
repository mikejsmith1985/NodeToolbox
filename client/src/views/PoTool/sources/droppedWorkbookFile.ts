// droppedWorkbookFile.ts — Working out what somebody actually dropped on the spreadsheet zone.
//
// A drop is not a file. Depending on where it was dragged FROM, the browser hands over any of:
//
//   - the real file, which is the case everything was written for;
//   - a preview thumbnail beside it — Outlook and Teams do this, and the image is often FIRST, so
//     taking `files[0]` reads the thumbnail and reports that a `.png` is not a spreadsheet;
//   - nothing but a URL, which is what a OneDrive or SharePoint link drag gives. There is no file
//     to read at all, and no amount of parsing will produce one.
//
// Each needs a different thing said to the person. "That file could not be read as a spreadsheet"
// is true of a GUID-named thumbnail and completely baffling, because they dragged a spreadsheet.
//
// Pure: it is handed the shapes a DataTransfer carries rather than the event, so every case is
// testable without a browser drag.

/** Extensions the workbook reader can actually open. Kept in step with `workbookSource`. */
const SUPPORTED_FILE_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv'];

/** What a drop carried, reduced to the parts that decide the outcome. */
export interface DroppedItems {
  /** Files the browser attached, in the order it supplied them. */
  files: readonly File[];
  /** `text/uri-list`, when the drag was of a link rather than a file. */
  uriList?: string;
}

/** The decision: a file to read, or the reason there is none. */
export type DroppedWorkbookOutcome =
  | { kind: 'file'; file: File }
  | { kind: 'link'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'empty'; message: string };

/** The extension of a file name, lower-cased, or '' when it has none. */
function readFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex === -1 ? '' : fileName.slice(lastDotIndex).toLowerCase();
}

/** True when a file's name claims an extension the workbook reader supports. */
function looksLikeSpreadsheet(file: File): boolean {
  return SUPPORTED_FILE_EXTENSIONS.includes(readFileExtension(file.name));
}

/** True when the dropped URL points at OneDrive or SharePoint, which is worth naming. */
function isCloudDocumentLink(uriList: string): boolean {
  const normalizedUri = uriList.toLowerCase();
  return normalizedUri.includes('sharepoint.com')
    || normalizedUri.includes('onedrive')
    || normalizedUri.includes('1drv.ms')
    || normalizedUri.includes('-my.sharepoint');
}

/**
 * Decides what to do with a drop.
 *
 * The spreadsheet is chosen by NAME rather than by position, because position is not reliable: a
 * drag from Outlook or Teams supplies a preview thumbnail alongside the attachment and frequently
 * puts the image first.
 *
 * A drop carrying only a URL is called out as a link, with the specific instruction that resolves
 * it. There is no fallback that could make it work — the file is in the cloud and the browser was
 * handed an address, not bytes.
 */
export function readDroppedWorkbookFile(dropped: DroppedItems): DroppedWorkbookOutcome {
  const spreadsheetFile = dropped.files.find((file) => looksLikeSpreadsheet(file));
  if (spreadsheetFile !== undefined) {
    return { kind: 'file', file: spreadsheetFile };
  }

  const uriList = (dropped.uriList ?? '').trim();
  if (dropped.files.length === 0 && uriList !== '') {
    return {
      kind: 'link',
      message: isCloudDocumentLink(uriList)
        ? 'That was a OneDrive or SharePoint link, not a file — the spreadsheet is still in the cloud, '
          + 'so there is nothing here to read. Open it, save a copy to this machine, then drag that '
          + 'copy in or use "click to choose one".'
        : 'That was a link, not a file. Save the spreadsheet to this machine first, then drag it in '
          + 'or use "click to choose one".',
    };
  }

  if (dropped.files.length === 0) {
    return {
      kind: 'empty',
      message: 'Nothing was dropped that this could read. Drag a spreadsheet from a folder, or use '
        + '"click to choose one".',
    };
  }

  // Files arrived, but none of them is a spreadsheet. Naming what DID arrive is what turns a baffling
  // message into an explanation — especially when it is a GUID-named thumbnail nobody chose.
  const droppedNames = dropped.files.map((file) => `"${file.name}"`).join(', ');
  return {
    kind: 'unsupported',
    message: `${droppedNames} is not a spreadsheet. Excel (.xlsx, .xlsm, .xls) and CSV files are `
      + 'supported. If you dragged from Outlook or Teams, save the attachment first and drag that.',
  };
}
