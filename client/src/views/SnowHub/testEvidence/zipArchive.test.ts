// zipArchive.test.ts — The bundle is a real zip: nested folders, exact bytes, nothing extra.

import * as CFB from 'cfb';
import { describe, expect, it } from 'vitest';

import { createZipArchive } from './zipArchive.ts';

const ZIP_LOCAL_HEADER_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

describe('createZipArchive', () => {
  it('produces bytes that begin with the zip local-file signature', () => {
    const archiveBytes = createZipArchive([{ path: 'a.txt', bytes: new Uint8Array([104, 105]) }]);

    expect(Array.from(archiveBytes.slice(0, 4))).toEqual(ZIP_LOCAL_HEADER_SIGNATURE);
  });

  it('round-trips nested paths and exact bytes', () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const archiveBytes = createZipArchive([
      { path: 'ENCUC-1/screens.png', bytes: imageBytes },
      { path: 'MANIFEST.txt', bytes: new TextEncoder().encode('manifest') },
    ]);

    const container = CFB.read(archiveBytes, { type: 'array' });
    const readPaths = container.FullPaths.filter((fullPath) => !fullPath.endsWith('/') && !fullPath.includes('\u0001'));
    expect(readPaths).toEqual(['Root Entry/ENCUC-1/screens.png', 'Root Entry/MANIFEST.txt']);

    const screensEntry = CFB.find(container, '/ENCUC-1/screens.png');
    expect(Array.from(screensEntry?.content as Uint8Array)).toEqual(Array.from(imageBytes));
  });

  it('tolerates a leading slash on a path rather than nesting an empty folder', () => {
    const archiveBytes = createZipArchive([{ path: '/ENCUC-2/a.txt', bytes: new Uint8Array([1]) }]);

    const container = CFB.read(archiveBytes, { type: 'array' });
    expect(CFB.find(container, '/ENCUC-2/a.txt')).not.toBeNull();
  });

  it('refuses an empty archive, which would be evidence of nothing', () => {
    expect(() => createZipArchive([])).toThrow('at least one file');
  });
});
