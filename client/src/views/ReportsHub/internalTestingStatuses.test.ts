// internalTestingStatuses.test.ts — Tests for the one definition of "which statuses mean internal testing".
//
// Two consumers read this: the Internal Testing Bottleneck panel and the internal-testing coverage
// metric that argues for testing headcount. If they ever read the choice differently, the coverage
// figure would contradict the bottleneck table sitting directly above it on the same page.
//
// The migration case is not decoration: an existing user picked their statuses back when the field was
// a comma-separated string. Dropping that on read would silently empty their configuration — and the
// coverage metric would then report "not configured" to someone who configured it months ago.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  BOTTLENECK_SETTINGS_STORAGE_KEY,
  parseStatusNames,
  readBottleneckSettings,
  readPersistedStatusNames,
  writeBottleneckSettings,
} from './internalTestingStatuses.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('parseStatusNames', () => {
  it('splits, trims and drops blanks', () => {
    expect(parseStatusNames(' Testing , Ready for Testing ,, ')).toEqual(['Testing', 'Ready for Testing']);
  });

  it('returns nothing for an empty string rather than one blank entry', () => {
    expect(parseStatusNames('')).toEqual([]);
  });
});

describe('readPersistedStatusNames', () => {
  it('reads the current array form', () => {
    expect(readPersistedStatusNames({ statusNames: ['Testing'] })).toEqual(['Testing']);
  });

  it('migrates the older comma-separated text form so an existing choice is not lost', () => {
    expect(readPersistedStatusNames({ statusNamesText: 'Testing, Ready for Testing' }))
      .toEqual(['Testing', 'Ready for Testing']);
  });

  it('drops non-string entries so corrupted storage cannot seed a bogus status', () => {
    expect(readPersistedStatusNames({ statusNames: ['Testing', 42, null] as unknown[] })).toEqual(['Testing']);
  });

  it('returns nothing when neither shape is present', () => {
    expect(readPersistedStatusNames({})).toEqual([]);
  });
});

describe('readBottleneckSettings', () => {
  it('round-trips what was written', () => {
    writeBottleneckSettings({ scopeJql: 'project = TBX', statusNames: ['Testing'] });

    expect(readBottleneckSettings()).toEqual({ scopeJql: 'project = TBX', statusNames: ['Testing'] });
  });

  it('returns blanks when nothing has been stored', () => {
    expect(readBottleneckSettings()).toEqual({ scopeJql: '', statusNames: [] });
  });

  it('returns blanks rather than throwing when the stored JSON is corrupt', () => {
    // A throw here would take down the whole report, not just this one setting.
    localStorage.setItem(BOTTLENECK_SETTINGS_STORAGE_KEY, '{not json');

    expect(readBottleneckSettings()).toEqual({ scopeJql: '', statusNames: [] });
  });

  it('reports no configured statuses rather than inventing one', () => {
    // The coverage metric treats "no statuses" as "do not compute". That is only safe if this never
    // manufactures a default — a guessed status would become a staffing claim that is not true.
    writeBottleneckSettings({ scopeJql: 'project = TBX', statusNames: [] });

    expect(readBottleneckSettings().statusNames).toEqual([]);
  });
});
