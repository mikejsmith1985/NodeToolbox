// test/helpers/makeMsgFixture.js — Generates SYNTHETIC Outlook .msg (CFBF) test fixtures.
//
// The .msg reader must be tested against real compound-file bytes, but we never want real email content in
// the repo. This writer builds a minimal-but-valid .msg from placeholder text: a header, a single FAT
// sector, a directory, a mini-FAT, and a mini stream holding the transport-headers and body property
// streams — exactly the slice parseMsg.ts reads. Run directly (`node test/helpers/makeMsgFixture.js`) to
// (re)generate the committed fixtures under test/fixtures/github-emails/.

'use strict';

const fs = require('fs');
const path = require('path');

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;
const OBJECT_TYPE_STREAM = 2;
const OBJECT_TYPE_ROOT = 5;

/** Pads a buffer up to a whole multiple of `multiple` bytes (with zeros). */
function padToMultiple(buffer, multiple) {
  const padded = Buffer.alloc(Math.ceil(buffer.length / multiple) * multiple);
  buffer.copy(padded);
  return padded;
}

/**
 * Builds a valid .msg byte array carrying the given transport headers and plain-text body. Layout:
 * sector 0 = FAT, 1 = directory, 2 = mini-FAT, 3.. = mini stream.
 */
function buildMsgBytes(transportHeaders, body) {
  const headerBytes = Buffer.from(transportHeaders, 'utf16le');
  const bodyBytes = Buffer.from(body, 'utf16le');
  const headerPadded = padToMultiple(headerBytes, MINI_SECTOR_SIZE);
  const bodyPadded = padToMultiple(bodyBytes, MINI_SECTOR_SIZE);
  const headerMiniSectors = headerPadded.length / MINI_SECTOR_SIZE;
  const bodyMiniSectors = bodyPadded.length / MINI_SECTOR_SIZE;
  const miniStream = Buffer.concat([headerPadded, bodyPadded]);
  const miniStreamMainSectors = Math.max(1, Math.ceil(miniStream.length / SECTOR_SIZE));
  const totalMainSectors = 3 + miniStreamMainSectors;

  const file = Buffer.alloc(SECTOR_SIZE + totalMainSectors * SECTOR_SIZE);
  const sectorOffset = (sector) => SECTOR_SIZE + sector * SECTOR_SIZE;

  // ── Header ──
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((byteValue, index) => { file[index] = byteValue; });
  file.writeUInt16LE(0x003e, 24); // minor version
  file.writeUInt16LE(3, 26);      // major version (512-byte sectors)
  file.writeUInt16LE(0xfffe, 28); // byte order marker
  file.writeUInt16LE(9, 30);      // sector shift → 512
  file.writeUInt16LE(6, 32);      // mini sector shift → 64
  file.writeUInt32LE(1, 44);      // number of FAT sectors
  file.writeUInt32LE(1, 48);      // first directory sector
  file.writeUInt32LE(MINI_STREAM_CUTOFF, 56);
  file.writeUInt32LE(2, 60);      // first mini-FAT sector
  file.writeUInt32LE(1, 64);      // number of mini-FAT sectors
  file.writeUInt32LE(END_OF_CHAIN, 68); // first DIFAT sector (none)
  file.writeUInt32LE(0, 72);      // number of DIFAT sectors
  file.writeUInt32LE(0, 76);      // DIFAT[0] → FAT lives in sector 0
  for (let index = 1; index < 109; index += 1) {
    file.writeUInt32LE(FREE_SECTOR, 76 + index * 4);
  }

  // ── FAT (sector 0) ──
  const fatOffset = sectorOffset(0);
  for (let index = 0; index < SECTOR_SIZE / 4; index += 1) {
    file.writeUInt32LE(FREE_SECTOR, fatOffset + index * 4);
  }
  file.writeUInt32LE(FAT_SECTOR, fatOffset + 0 * 4);     // sector 0 is the FAT
  file.writeUInt32LE(END_OF_CHAIN, fatOffset + 1 * 4);   // directory (1 sector)
  file.writeUInt32LE(END_OF_CHAIN, fatOffset + 2 * 4);   // mini-FAT (1 sector)
  for (let index = 0; index < miniStreamMainSectors; index += 1) {
    const sector = 3 + index;
    const next = index === miniStreamMainSectors - 1 ? END_OF_CHAIN : sector + 1;
    file.writeUInt32LE(next, fatOffset + sector * 4);
  }

  // ── Directory (sector 1) ──
  const directoryOffset = sectorOffset(1);
  const writeDirectoryEntry = (entryIndex, name, objectType, startSector, streamSize) => {
    const base = directoryOffset + entryIndex * 128;
    const nameBytes = Buffer.from(name, 'utf16le');
    nameBytes.copy(file, base);
    file.writeUInt16LE(nameBytes.length + 2, base + 64); // name length incl. UTF-16 null terminator
    file.writeUInt8(objectType, base + 66);
    file.writeUInt8(1, base + 67); // colour: black
    file.writeUInt32LE(FREE_SECTOR, base + 68); // left sibling: none
    file.writeUInt32LE(FREE_SECTOR, base + 72); // right sibling: none
    file.writeUInt32LE(FREE_SECTOR, base + 76); // child: none (reader iterates linearly)
    file.writeUInt32LE(startSector, base + 116);
    file.writeUInt32LE(streamSize, base + 120); // low 4 bytes of the 64-bit size
  };
  writeDirectoryEntry(0, 'Root Entry', OBJECT_TYPE_ROOT, 3, miniStream.length);
  writeDirectoryEntry(1, '__substg1.0_007D001F', OBJECT_TYPE_STREAM, 0, headerBytes.length);
  writeDirectoryEntry(2, '__substg1.0_1000001F', OBJECT_TYPE_STREAM, headerMiniSectors, bodyBytes.length);

  // ── Mini-FAT (sector 2) ──
  const miniFatOffset = sectorOffset(2);
  for (let index = 0; index < SECTOR_SIZE / 4; index += 1) {
    file.writeUInt32LE(FREE_SECTOR, miniFatOffset + index * 4);
  }
  for (let index = 0; index < headerMiniSectors; index += 1) {
    const next = index === headerMiniSectors - 1 ? END_OF_CHAIN : index + 1;
    file.writeUInt32LE(next, miniFatOffset + index * 4);
  }
  for (let index = 0; index < bodyMiniSectors; index += 1) {
    const miniSector = headerMiniSectors + index;
    const next = index === bodyMiniSectors - 1 ? END_OF_CHAIN : miniSector + 1;
    file.writeUInt32LE(next, miniFatOffset + miniSector * 4);
  }

  // ── Mini stream (sectors 3..) ──
  miniStream.copy(file, sectorOffset(3));

  return file;
}

/** Builds a synthetic GitHub-notification .msg from placeholder header/body fields. */
function buildGithubNotificationMsg({ subject, listId, sender, reason, messageId, body }) {
  const headers = [
    'From: "Test User (CTR)" <notifications@github.com>',
    'To: testorg/testrepo <testrepo@noreply.github.com>',
    'Date: Thu, 24 Jul 2026 12:00:00 -0000',
    'Message-ID: ' + messageId,
    'Subject: ' + subject,
    'List-ID: ' + listId,
    'X-GitHub-Sender: ' + sender,
    'X-GitHub-Reason: ' + reason,
    'Content-Type: text/plain; charset=UTF-8',
  ].join('\r\n');
  return buildMsgBytes(headers, body);
}

// Regenerate the committed fixtures when run directly.
if (require.main === module) {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'github-emails');
  fs.mkdirSync(fixturesDir, { recursive: true });

  fs.writeFileSync(path.join(fixturesDir, 'synthetic-review-requested.msg'), buildGithubNotificationMsg({
    subject: 'Re: [testorg/testrepo] [TEST-123] Do the thing (PR #7)',
    listId: 'testorg/testrepo <testrepo.testorg.github.com>',
    sender: 'OCTOCAT_TEST',
    reason: 'review_requested',
    messageId: '<testorg/testrepo/pull/7/issue_event/1@github.com>',
    body: 'OCTOCAT_TEST requested review on: testorg/testrepo#7 [TEST-123] Do the thing.',
  }));

  fs.writeFileSync(path.join(fixturesDir, 'synthetic-commit-pushed-keyless.msg'), buildGithubNotificationMsg({
    subject: 'Re: [testorg/testrepo] daily build (PR #8)',
    listId: 'testorg/testrepo <testrepo.testorg.github.com>',
    sender: 'OCTOCAT_TEST',
    reason: 'push',
    messageId: '<testorg/testrepo/pull/8/push/1@github.com>',
    body: 'OCTOCAT_TEST pushed 1 commit. abc1234 update files. View it on GitHub or unsubscribe.',
  }));

  // eslint-disable-next-line no-console
  console.log('Synthetic .msg fixtures written to ' + fixturesDir);
}

module.exports = { buildMsgBytes, buildGithubNotificationMsg };
