// zipArchive.ts — Writing a zip file in the browser, with the library the app already ships.
//
// Framework-first: `cfb` (a dependency of the SheetJS build already in package.json) writes
// standard ZIP containers, so no zip library is added and no zip format code is written here.
// This module is only the seam that turns "paths and bytes" into "one archive".

import * as CFB from 'cfb';

/** One file to place in the archive: its path inside the zip and its exact bytes. */
export interface ZipArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

const LEADING_SLASHES = /^\/+/;

/**
 * Builds a deflated zip from the given entries and returns its bytes.
 *
 * Throws on an empty entry list: an evidence archive with nothing inside is a mistake somewhere
 * upstream, and attaching it to a change would look like evidence while proving nothing.
 */
export function createZipArchive(entries: readonly ZipArchiveEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error('A zip archive needs at least one file.');
  }

  const container = CFB.utils.cfb_new();
  entries.forEach((entry) => {
    // cfb addresses every file from the container root, so the path must carry exactly one
    // leading slash — a doubled one would create a nameless top-level folder.
    const rootedPath = `/${entry.path.replace(LEADING_SLASHES, '')}`;
    CFB.utils.cfb_add(container, rootedPath, entry.bytes);
  });

  const archiveBytes = CFB.write(container, { fileType: 'zip', type: 'array', compression: true });
  return archiveBytes instanceof Uint8Array ? archiveBytes : Uint8Array.from(archiveBytes as ArrayLike<number>);
}
