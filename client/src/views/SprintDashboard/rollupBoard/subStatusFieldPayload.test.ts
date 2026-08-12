// subStatusFieldPayload.test.ts — Proves the board writes a cascading sub-status the way Jira defines
// it, rather than guessing a flat value and being told "Could not find valid 'id' or 'value' in the
// Parent Option object" — the 400 that made ENCUC-2201 unmovable on the board while the identical
// change made by hand in Jira worked.

import { describe, expect, it } from 'vitest';

import {
  buildSubStatusFieldValue,
  describeSubStatusMismatch,
  findSubStatusOption,
  listSelectableSubStatusLabels,
  resolveSubStatusFieldValue,
} from './subStatusFieldPayload.ts';
import type { FeatureReviewEditMetaAllowedValue } from '../featureReviewFixes.ts';

/** A cascading Sub-Status field whose parents mirror the statuses, as this instance defines it. */
const CASCADING_OPTIONS: FeatureReviewEditMetaAllowedValue[] = [
  { id: '100', value: 'Working', children: [{ id: '101', value: 'Code Review' }, { id: '102', value: 'New' }] },
  {
    id: '200',
    value: 'Ready for Testing',
    children: [
      { id: '201', value: 'Testing' },
      { id: '202', value: 'Integration Test' },
    ],
  },
  { id: '300', value: 'Monitoring', children: [{ id: '301', value: 'Testing' }] },
];

/** A plain, uncascaded select — the shape the board used to assume was universal. */
const FLAT_OPTIONS: FeatureReviewEditMetaAllowedValue[] = [
  { id: '10', value: 'Dev In Progress' },
  { id: '11', value: 'Dev Complete' },
];

describe('findSubStatusOption', () => {
  it('finds a top-level option and reports no child', () => {
    const match = findSubStatusOption(CASCADING_OPTIONS, 'Working', 'Working');

    expect(match?.parent.value).toBe('Working');
    expect(match?.child).toBeNull();
  });

  it('finds a nested option and reports the parent it belongs to', () => {
    const match = findSubStatusOption(CASCADING_OPTIONS, 'Integration Test', 'Ready for Testing');

    expect(match?.parent.value).toBe('Ready for Testing');
    expect(match?.child?.value).toBe('Integration Test');
  });

  it('picks the parent matching the target status when the same child sits under several', () => {
    // "Testing" exists under both "Ready for Testing" and "Monitoring". A column mapped
    // `Ready for Testing / Testing` means the first one.
    const match = findSubStatusOption(CASCADING_OPTIONS, 'Testing', 'Ready for Testing');

    expect(match?.parent.value).toBe('Ready for Testing');
  });

  it('matches whatever casing the mapping was typed in', () => {
    expect(findSubStatusOption(CASCADING_OPTIONS, 'code review', 'Working')?.child?.value).toBe('Code Review');
  });

  it('finds nothing for a value the field does not offer, rather than inventing one', () => {
    expect(findSubStatusOption(CASCADING_OPTIONS, 'Nowhere', 'Working')).toBeNull();
  });

  it('still works on a plain, uncascaded field', () => {
    const match = findSubStatusOption(FLAT_OPTIONS, 'Dev Complete', 'In Progress');

    expect(match?.parent.value).toBe('Dev Complete');
    expect(match?.child).toBeNull();
  });
});

describe('buildSubStatusFieldValue', () => {
  it('sends the parent AND the child together, which is what the 400 was about', () => {
    const match = findSubStatusOption(CASCADING_OPTIONS, 'Testing', 'Ready for Testing');

    expect(buildSubStatusFieldValue(match!)).toEqual({ id: '200', child: { id: '201' } });
  });

  it('sends a top-level option on its own', () => {
    const match = findSubStatusOption(CASCADING_OPTIONS, 'Working', 'Working');

    expect(buildSubStatusFieldValue(match!)).toEqual({ id: '100' });
  });

  it('falls back to labels when the field offers no ids', () => {
    const labelOnlyOptions: FeatureReviewEditMetaAllowedValue[] = [
      { value: 'Ready for Testing', children: [{ value: 'Testing' }] },
    ];
    const match = findSubStatusOption(labelOnlyOptions, 'Testing', 'Ready for Testing');

    expect(buildSubStatusFieldValue(match!)).toEqual({ value: 'Ready for Testing', child: { value: 'Testing' } });
  });
});

describe('resolveSubStatusFieldValue', () => {
  it('clears the field without any lookup, since no option means "none"', () => {
    expect(resolveSubStatusFieldValue(undefined, null, 'Working')).toEqual({ kind: 'write', fieldValue: null });
  });

  it('resolves a nested value into the full parent-and-child write', () => {
    const resolution = resolveSubStatusFieldValue(
      { allowedValues: CASCADING_OPTIONS },
      'Testing',
      'Ready for Testing',
    );

    expect(resolution).toEqual({ kind: 'write', fieldValue: { id: '200', child: { id: '201' } } });
  });

  it('refuses a value the field does not offer, instead of posting it and getting a 400', () => {
    const resolution = resolveSubStatusFieldValue({ allowedValues: CASCADING_OPTIONS }, 'Testng', 'Working');

    expect(resolution.kind).toBe('unwritable');
  });

  it('names the options the field DOES accept, so the mapping can be corrected', () => {
    const resolution = resolveSubStatusFieldValue({ allowedValues: CASCADING_OPTIONS }, 'Testng', 'Working');

    expect(resolution.kind === 'unwritable' && resolution.reason).toContain('Ready for Testing / Testing');
    expect(resolution.kind === 'unwritable' && resolution.reason).toContain('Board setup');
  });

  it('says the field is not on this issue when it offers nothing at all', () => {
    const resolution = resolveSubStatusFieldValue({ allowedValues: [] }, 'Testing', 'Working');

    expect(resolution.kind === 'unwritable' && resolution.reason).toContain('no options at all');
  });
});

describe('listSelectableSubStatusLabels', () => {
  it('names nested options by both halves, the way the field presents them', () => {
    const labels = listSelectableSubStatusLabels(CASCADING_OPTIONS);

    expect(labels).toContain('Working');
    expect(labels).toContain('Working / Code Review');
  });
});

describe('describeSubStatusMismatch', () => {
  it('quotes the value that failed so it can be found in Board setup', () => {
    expect(describeSubStatusMismatch('Testng', CASCADING_OPTIONS)).toContain('"Testng"');
  });
});
