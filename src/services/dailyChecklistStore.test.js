// dailyChecklistStore.test.js — Unit tests for the per-user, per-day "Today" checklist store.
// Each test uses its own temp file so reads/writes never collide.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadAllChecklistState,
  getDailyChecklist,
  setCategoryComplete,
} = require('./dailyChecklistStore');

const TODAY_KEY = '2026-06-30';
const YESTERDAY_KEY = '2026-06-29';

let testStorePath;

beforeEach(() => {
  testStorePath = path.join(os.tmpdir(), `sm-checklist-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
});

afterEach(() => {
  if (fs.existsSync(testStorePath)) {
    fs.unlinkSync(testStorePath);
  }
});

describe('loadAllChecklistState', () => {
  it('returns an empty object when the store file does not exist', () => {
    expect(loadAllChecklistState(testStorePath)).toEqual({});
  });

  it('returns an empty object when the store file is corrupt', () => {
    fs.writeFileSync(testStorePath, 'not json at all');
    expect(loadAllChecklistState(testStorePath)).toEqual({});
  });
});

describe('getDailyChecklist', () => {
  it('returns an empty object for an unknown user/day', () => {
    expect(getDailyChecklist('nobody', TODAY_KEY, testStorePath)).toEqual({});
  });
});

describe('setCategoryComplete', () => {
  it('records a completed category with a completedAt timestamp for that day', () => {
    setCategoryComplete(
      { userKey: 'jsmith', dayKey: TODAY_KEY, categoryId: 'standup', isComplete: true },
      testStorePath,
    );

    const todayMap = getDailyChecklist('jsmith', TODAY_KEY, testStorePath);
    expect(todayMap).toHaveProperty('standup');
    expect(typeof todayMap.standup.completedAt).toBe('string');
  });

  it('does not surface a completed category on a different day (daily reset)', () => {
    setCategoryComplete(
      { userKey: 'jsmith', dayKey: YESTERDAY_KEY, categoryId: 'standup', isComplete: true },
      testStorePath,
    );

    expect(getDailyChecklist('jsmith', TODAY_KEY, testStorePath)).toEqual({});
  });

  it('prunes the prior day\'s bucket when writing for a new day', () => {
    setCategoryComplete(
      { userKey: 'jsmith', dayKey: YESTERDAY_KEY, categoryId: 'standup', isComplete: true },
      testStorePath,
    );
    setCategoryComplete(
      { userKey: 'jsmith', dayKey: TODAY_KEY, categoryId: 'grooming', isComplete: true },
      testStorePath,
    );

    const persisted = loadAllChecklistState(testStorePath);
    expect(persisted.jsmith).toHaveProperty(TODAY_KEY);
    expect(persisted.jsmith).not.toHaveProperty(YESTERDAY_KEY);
  });

  it('removes a category when isComplete is false', () => {
    setCategoryComplete({ userKey: 'jsmith', dayKey: TODAY_KEY, categoryId: 'standup', isComplete: true }, testStorePath);
    const todayMap = setCategoryComplete(
      { userKey: 'jsmith', dayKey: TODAY_KEY, categoryId: 'standup', isComplete: false },
      testStorePath,
    );

    expect(todayMap).not.toHaveProperty('standup');
    expect(getDailyChecklist('jsmith', TODAY_KEY, testStorePath)).not.toHaveProperty('standup');
  });

  it('keeps each user\'s checklist separate', () => {
    setCategoryComplete({ userKey: 'jsmith', dayKey: TODAY_KEY, categoryId: 'standup', isComplete: true }, testStorePath);
    setCategoryComplete({ userKey: 'bjones', dayKey: TODAY_KEY, categoryId: 'grooming', isComplete: true }, testStorePath);

    expect(getDailyChecklist('jsmith', TODAY_KEY, testStorePath)).toHaveProperty('standup');
    expect(getDailyChecklist('jsmith', TODAY_KEY, testStorePath)).not.toHaveProperty('grooming');
    expect(getDailyChecklist('bjones', TODAY_KEY, testStorePath)).toHaveProperty('grooming');
  });
});
