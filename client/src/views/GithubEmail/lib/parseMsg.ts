// parseMsg.ts — A minimal, dependency-free Outlook .msg (CFBF / OLE2) reader for GitHub notification emails.
//
// Outlook saves notification emails as .msg — the Compound File Binary Format, a tiny in-file "filesystem"
// of named byte streams. Crucially, GitHub's full internet headers (X-GitHub-Sender, X-GitHub-Reason,
// List-ID, Subject, Date, Message-ID) are stored VERBATIM in the transport-headers property stream, so the
// existing RFC-822 classifier can be reused unchanged: this reader extracts those raw headers plus the
// plain-text body and reassembles them into an email source string that parseMime already understands.
//
// It parses only the slice of CFBF that .msg files actually use (header, FAT, directory, mini-FAT/mini
// stream), with no dependencies. It runs in BOTH the browser (client tests) and the bundled Node engine,
// so it relies only on cross-environment primitives (DataView, TextDecoder) — never Node's Buffer API.

/** The 8-byte magic number that begins every compound (OLE2) file. */
const CFBF_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Sector-chain sentinels: end-of-chain and free/unused. */
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

/** Directory object types we care about. */
const OBJECT_TYPE_STREAM = 2;
const OBJECT_TYPE_ROOT = 5;

/** Each directory entry is a fixed 128 bytes. */
const DIRECTORY_ENTRY_SIZE = 128;
/** The header's inline DIFAT holds up to 109 FAT-sector locations — enough for any email-sized file. */
const HEADER_DIFAT_COUNT = 109;

/** The parts of a .msg we extract: the raw internet headers and the plain-text body. */
export interface ParsedMsg {
  transportHeaders: string | null;
  bodyText: string | null;
}

/** A decoded compound-file directory entry (one named stream or storage). */
interface DirectoryEntry {
  name: string;
  objectType: number;
  startSector: number;
  streamSize: number;
}

/** True when the byte array begins with the compound-file magic number. */
function hasCompoundFileSignature(bytes: Uint8Array): boolean {
  if (bytes.length < CFBF_SIGNATURE.length) {
    return false;
  }
  return CFBF_SIGNATURE.every((signatureByte, index) => bytes[index] === signatureByte);
}

/**
 * Follows a sector chain through a FAT table, returning the ordered list of sector numbers. A visited-set
 * and a hard cap guard against a corrupt file producing an infinite loop.
 */
function followSectorChain(fat: number[], startSector: number, maxSectors: number): number[] {
  const chain: number[] = [];
  const visited = new Set<number>();
  let current = startSector;
  while (current !== END_OF_CHAIN && current !== FREE_SECTOR && current < fat.length && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    if (chain.length > maxSectors) {
      break;
    }
    current = fat[current];
  }
  return chain;
}

/** Concatenates the bytes of a sector chain from the main file, truncated to the stream's real size. */
function readFromFat(
  bytes: Uint8Array,
  fat: number[],
  startSector: number,
  streamSize: number,
  sectorSize: number,
): Uint8Array {
  const sectorNumbers = followSectorChain(fat, startSector, Math.ceil(bytes.length / sectorSize) + 1);
  const collected = new Uint8Array(sectorNumbers.length * sectorSize);
  sectorNumbers.forEach((sectorNumber, index) => {
    const fileOffset = (sectorNumber + 1) * sectorSize;
    collected.set(bytes.subarray(fileOffset, fileOffset + sectorSize), index * sectorSize);
  });
  return collected.subarray(0, streamSize);
}

/** Concatenates the bytes of a mini-sector chain from the mini stream, truncated to the stream's size. */
function readFromMiniFat(
  miniStream: Uint8Array,
  miniFat: number[],
  startMiniSector: number,
  streamSize: number,
  miniSectorSize: number,
): Uint8Array {
  const miniSectorNumbers = followSectorChain(miniFat, startMiniSector, Math.ceil(miniStream.length / miniSectorSize) + 1);
  const collected = new Uint8Array(miniSectorNumbers.length * miniSectorSize);
  miniSectorNumbers.forEach((miniSectorNumber, index) => {
    const offset = miniSectorNumber * miniSectorSize;
    collected.set(miniStream.subarray(offset, offset + miniSectorSize), index * miniSectorSize);
  });
  return collected.subarray(0, streamSize);
}

/** Reads the inline DIFAT (first 109 FAT-sector locations) and assembles the full FAT as a uint32 array. */
function buildFat(view: DataView, sectorSize: number): number[] {
  const fat: number[] = [];
  const entriesPerSector = sectorSize / 4;
  for (let difatIndex = 0; difatIndex < HEADER_DIFAT_COUNT; difatIndex += 1) {
    const fatSector = view.getUint32(76 + difatIndex * 4, true);
    if (fatSector === FREE_SECTOR || fatSector === END_OF_CHAIN) {
      continue;
    }
    const fileOffset = (fatSector + 1) * sectorSize;
    for (let entryIndex = 0; entryIndex < entriesPerSector; entryIndex += 1) {
      fat.push(view.getUint32(fileOffset + entryIndex * 4, true));
    }
  }
  return fat;
}

/** Parses a mini-FAT byte block into a uint32 array. */
function parseMiniFat(miniFatBytes: Uint8Array): number[] {
  const miniFatView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat: number[] = [];
  for (let offset = 0; offset + 4 <= miniFatBytes.byteLength; offset += 4) {
    miniFat.push(miniFatView.getUint32(offset, true));
  }
  return miniFat;
}

/** Decodes every 128-byte directory entry from the concatenated directory stream. */
function parseDirectoryEntries(directoryBytes: Uint8Array): DirectoryEntry[] {
  const view = new DataView(directoryBytes.buffer, directoryBytes.byteOffset, directoryBytes.byteLength);
  const utf16Decoder = new TextDecoder('utf-16le');
  const entries: DirectoryEntry[] = [];
  for (let entryOffset = 0; entryOffset + DIRECTORY_ENTRY_SIZE <= directoryBytes.byteLength; entryOffset += DIRECTORY_ENTRY_SIZE) {
    const nameByteLength = view.getUint16(entryOffset + 64, true);
    const objectType = view.getUint8(entryOffset + 66);
    if (objectType !== OBJECT_TYPE_STREAM && objectType !== OBJECT_TYPE_ROOT) {
      continue;
    }
    // nameByteLength counts the trailing UTF-16 null terminator; drop it before decoding.
    const nameBytes = directoryBytes.subarray(entryOffset, entryOffset + Math.max(0, nameByteLength - 2));
    entries.push({
      name: utf16Decoder.decode(nameBytes),
      objectType,
      startSector: view.getUint32(entryOffset + 116, true),
      streamSize: view.getUint32(entryOffset + 120, true),
    });
  }
  return entries;
}

/** Decodes a property stream's bytes: UTF-16LE for a `…001F` name, Windows-1252 for a `…001E` name. */
function decodePropertyStream(name: string, streamBytes: Uint8Array): string {
  const isUnicode = /001f$/i.test(name);
  return new TextDecoder(isUnicode ? 'utf-16le' : 'windows-1252').decode(streamBytes);
}

/** Reads a directory entry's bytes from either the main FAT or the mini stream, by its size. */
function readEntryBytes(
  entry: DirectoryEntry,
  context: { bytes: Uint8Array; fat: number[]; miniFat: number[]; miniStream: Uint8Array; sectorSize: number; miniSectorSize: number; miniCutoff: number },
): Uint8Array {
  if (entry.streamSize >= context.miniCutoff) {
    return readFromFat(context.bytes, context.fat, entry.startSector, entry.streamSize, context.sectorSize);
  }
  return readFromMiniFat(context.miniStream, context.miniFat, entry.startSector, entry.streamSize, context.miniSectorSize);
}

/**
 * Parses a .msg byte array into its transport headers and plain-text body. Returns nulls for whichever
 * part is absent. Never throws on malformed input — anything it cannot read yields nulls so the caller can
 * route the file to an error folder rather than crash the run.
 */
export function parseMsg(bytes: Uint8Array): ParsedMsg {
  if (!hasCompoundFileSignature(bytes)) {
    return { transportHeaders: null, bodyText: null };
  }

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorSize = 1 << view.getUint16(30, true);
    const miniSectorSize = 1 << view.getUint16(32, true);
    const firstDirectorySector = view.getUint32(48, true);
    const miniCutoff = view.getUint32(56, true) || 4096;
    const firstMiniFatSector = view.getUint32(60, true);

    const fat = buildFat(view, sectorSize);
    const directoryBytes = readFromFat(bytes, fat, firstDirectorySector, Number.MAX_SAFE_INTEGER, sectorSize);
    const entries = parseDirectoryEntries(directoryBytes);

    const rootEntry = entries.find((entry) => entry.objectType === OBJECT_TYPE_ROOT);
    const miniStream = rootEntry
      ? readFromFat(bytes, fat, rootEntry.startSector, rootEntry.streamSize, sectorSize)
      : new Uint8Array(0);
    const miniFatBytes = firstMiniFatSector === END_OF_CHAIN
      ? new Uint8Array(0)
      : readFromFat(bytes, fat, firstMiniFatSector, Number.MAX_SAFE_INTEGER, sectorSize);
    const miniFat = parseMiniFat(miniFatBytes);

    const context = { bytes, fat, miniFat, miniStream, sectorSize, miniSectorSize, miniCutoff };
    const readNamed = (candidateNames: string[]): string | null => {
      const entry = entries.find((candidate) =>
        candidate.objectType === OBJECT_TYPE_STREAM &&
        candidateNames.some((name) => candidate.name.toLowerCase() === name.toLowerCase()));
      return entry ? decodePropertyStream(entry.name, readEntryBytes(entry, context)) : null;
    };

    return {
      // 0x007D = PR_TRANSPORT_MESSAGE_HEADERS, 0x1000 = PR_BODY (plain text). 001F = Unicode, 001E = ASCII.
      transportHeaders: readNamed(['__substg1.0_007D001F', '__substg1.0_007D001E']),
      bodyText: readNamed(['__substg1.0_1000001F', '__substg1.0_1000001E']),
    };
  } catch {
    return { transportHeaders: null, bodyText: null };
  }
}

/** Removes a header line (and any folded continuation lines) for the named header, case-insensitively. */
function stripHeader(headerLines: string[], headerName: string): string[] {
  const result: string[] = [];
  let isSkipping = false;
  for (const line of headerLines) {
    const isContinuation = /^[ \t]/.test(line);
    if (isSkipping && isContinuation) {
      continue; // a folded continuation of the header being removed
    }
    isSkipping = new RegExp('^' + headerName + ':', 'i').test(line);
    if (!isSkipping) {
      result.push(line);
    }
  }
  return result;
}

/**
 * Converts a .msg byte array into an RFC-822 email source string the existing MIME parser understands, or
 * null when it is not a readable .msg (no transport headers). The original Content-Type / -Transfer-Encoding
 * headers are removed because the reconstructed body is the already-decoded plain text, not the original
 * MIME payload — leaving them would make the parser try to re-split a multipart body that is no longer there.
 */
export function msgBytesToEmailSource(bytes: Uint8Array): string | null {
  const parsed = parseMsg(bytes);
  if (parsed.transportHeaders === null || parsed.transportHeaders.trim() === '') {
    return null;
  }

  const headerLines = parsed.transportHeaders.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
  const withoutBodyEncoding = stripHeader(stripHeader(headerLines, 'content-type'), 'content-transfer-encoding');
  return withoutBodyEncoding.join('\r\n') + '\r\n\r\n' + (parsed.bodyText || '');
}
