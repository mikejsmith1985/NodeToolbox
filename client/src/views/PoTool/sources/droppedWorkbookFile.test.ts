// droppedWorkbookFile.test.ts — What a drop actually carried, and what to say about it.

import { describe, expect, it } from 'vitest';

import { readDroppedWorkbookFile } from './droppedWorkbookFile.ts';

/** A File with just the name the decision reads. */
function file(name: string): File {
  return new File(['x'], name);
}

describe('readDroppedWorkbookFile', () => {
  it('takes the spreadsheet when it is the only file', () => {
    const outcome = readDroppedWorkbookFile({ files: [file('scope.xlsx')] });

    expect(outcome).toEqual({ kind: 'file', file: expect.objectContaining({ name: 'scope.xlsx' }) });
  });

  it('finds the spreadsheet even when a preview thumbnail comes FIRST', () => {
    // Outlook and Teams supply a preview image beside the attachment, and it is frequently first —
    // so taking files[0] reported that a GUID-named .png was not a spreadsheet (GH #376).
    const outcome = readDroppedWorkbookFile({
      files: [file('205a8d63-3156-4ad4-855b-aa8017c4e91e.png'), file('scope.xlsx')],
    });

    expect(outcome).toEqual({ kind: 'file', file: expect.objectContaining({ name: 'scope.xlsx' }) });
  });

  it('accepts every extension the workbook reader opens', () => {
    ['scope.xlsx', 'scope.xlsm', 'scope.xls', 'scope.csv'].forEach((fileName) => {
      expect(readDroppedWorkbookFile({ files: [file(fileName)] }).kind).toBe('file');
    });
  });

  it('is not fooled by case', () => {
    expect(readDroppedWorkbookFile({ files: [file('SCOPE.XLSX')] }).kind).toBe('file');
  });

  it('takes the FIRST spreadsheet when several were dropped', () => {
    const outcome = readDroppedWorkbookFile({ files: [file('a.xlsx'), file('b.xlsx')] });

    expect(outcome).toEqual({ kind: 'file', file: expect.objectContaining({ name: 'a.xlsx' }) });
  });
});

describe('readDroppedWorkbookFile — a link is not a file', () => {
  it('names a OneDrive link and says what to do instead', () => {
    // The actual cause: the spreadsheet is still in the cloud, so there is nothing here to read and
    // no parsing that could change that.
    const outcome = readDroppedWorkbookFile({
      files: [],
      uriList: 'https://contoso-my.sharepoint.com/personal/x/Documents/scope.xlsx',
    });

    expect(outcome.kind).toBe('link');
    expect(outcome.kind === 'link' && outcome.message).toContain('OneDrive or SharePoint link');
    expect(outcome.kind === 'link' && outcome.message).toContain('save a copy to this machine');
  });

  it('recognises a 1drv.ms short link', () => {
    const outcome = readDroppedWorkbookFile({ files: [], uriList: 'https://1drv.ms/x/s!Abc123' });

    expect(outcome.kind === 'link' && outcome.message).toContain('OneDrive or SharePoint');
  });

  it('still explains an ordinary link without claiming it was OneDrive', () => {
    const outcome = readDroppedWorkbookFile({ files: [], uriList: 'https://example.com/scope.xlsx' });

    expect(outcome.kind).toBe('link');
    expect(outcome.kind === 'link' && outcome.message).not.toContain('OneDrive');
  });

  it('prefers a real file over a URL when the drop carried both', () => {
    // Some drags supply both; the bytes win over the address every time.
    const outcome = readDroppedWorkbookFile({
      files: [file('scope.xlsx')],
      uriList: 'https://contoso-my.sharepoint.com/scope.xlsx',
    });

    expect(outcome.kind).toBe('file');
  });
});

describe('readDroppedWorkbookFile — saying what did arrive', () => {
  it('names the files that were dropped, so a GUID thumbnail is explained rather than blamed', () => {
    const outcome = readDroppedWorkbookFile({ files: [file('205a8d63.png')] });

    expect(outcome.kind).toBe('unsupported');
    expect(outcome.kind === 'unsupported' && outcome.message).toContain('"205a8d63.png"');
    expect(outcome.kind === 'unsupported' && outcome.message).toContain('Outlook or Teams');
  });

  it('names every file when several unsupported ones arrived', () => {
    const outcome = readDroppedWorkbookFile({ files: [file('a.png'), file('b.pdf')] });

    expect(outcome.kind === 'unsupported' && outcome.message).toContain('"a.png", "b.pdf"');
  });

  it('says plainly when the drop carried nothing at all', () => {
    const outcome = readDroppedWorkbookFile({ files: [] });

    expect(outcome.kind).toBe('empty');
    expect(outcome.kind === 'empty' && outcome.message).toContain('click to choose one');
  });

  it('treats a blank uri-list as nothing rather than as a link', () => {
    expect(readDroppedWorkbookFile({ files: [], uriList: '   ' }).kind).toBe('empty');
  });
});
