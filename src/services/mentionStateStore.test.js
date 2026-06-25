// mentionStateStore.test.js — Unit tests for the per-user "addressed mentions" store.
// Each test uses its own temp file so reads/writes never collide.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadAllMentionState,
  getAddressedMentions,
  setMentionAddressed,
} = require('./mentionStateStore');

let testStorePath;

beforeEach(() => {
  testStorePath = path.join(os.tmpdir(), `mention-state-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
});

afterEach(() => {
  if (fs.existsSync(testStorePath)) {
    fs.unlinkSync(testStorePath);
  }
});

describe('loadAllMentionState', () => {
  it('returns an empty object when the store file does not exist', () => {
    expect(loadAllMentionState(testStorePath)).toEqual({});
  });

  it('returns an empty object when the store file is corrupt', () => {
    fs.writeFileSync(testStorePath, 'not json at all');
    expect(loadAllMentionState(testStorePath)).toEqual({});
  });
});

describe('setMentionAddressed', () => {
  it('records an addressed mention namespaced under the user key', () => {
    const userMap = setMentionAddressed(
      { userKey: 'jsmith', mentionKey: 'TBX-1#101', issueKey: 'TBX-1', isAddressed: true },
      testStorePath,
    );

    expect(userMap['TBX-1#101']).toBeDefined();
    expect(userMap['TBX-1#101'].issueKey).toBe('TBX-1');
    expect(typeof userMap['TBX-1#101'].addressedAt).toBe('string');
  });

  it('persists across reads', () => {
    setMentionAddressed(
      { userKey: 'jsmith', mentionKey: 'TBX-1#101', issueKey: 'TBX-1', isAddressed: true },
      testStorePath,
    );

    expect(getAddressedMentions('jsmith', testStorePath)).toHaveProperty('TBX-1#101');
  });

  it('keeps each user\'s addressed list separate', () => {
    setMentionAddressed({ userKey: 'jsmith', mentionKey: 'TBX-1#101', issueKey: 'TBX-1', isAddressed: true }, testStorePath);
    setMentionAddressed({ userKey: 'bjones', mentionKey: 'TBX-9#909', issueKey: 'TBX-9', isAddressed: true }, testStorePath);

    expect(getAddressedMentions('jsmith', testStorePath)).toHaveProperty('TBX-1#101');
    expect(getAddressedMentions('jsmith', testStorePath)).not.toHaveProperty('TBX-9#909');
    expect(getAddressedMentions('bjones', testStorePath)).toHaveProperty('TBX-9#909');
  });

  it('removes a mention when isAddressed is false (undo)', () => {
    setMentionAddressed({ userKey: 'jsmith', mentionKey: 'TBX-1#101', issueKey: 'TBX-1', isAddressed: true }, testStorePath);
    const userMap = setMentionAddressed(
      { userKey: 'jsmith', mentionKey: 'TBX-1#101', issueKey: 'TBX-1', isAddressed: false },
      testStorePath,
    );

    expect(userMap).not.toHaveProperty('TBX-1#101');
    expect(getAddressedMentions('jsmith', testStorePath)).not.toHaveProperty('TBX-1#101');
  });
});

describe('getAddressedMentions', () => {
  it('returns an empty object for an unknown user', () => {
    expect(getAddressedMentions('nobody', testStorePath)).toEqual({});
  });
});
