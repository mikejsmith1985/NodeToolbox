// issueTimeline.test.ts — Unit tests for the shared history reconstruction.
//
// This module is extracted from personalFlow.ts so that BOTH the person-centric report and the
// issue-centric flow analysis derive from one reconstruction. That is what makes them agree about
// the same issue by construction rather than by discipline.
//
// The test that matters most is the second one: the same span builder driven by an object value
// type. The person-centric engine uses `boolean` (was-this-mine); the flow analysis uses an assignee
// identity. If genericity ever breaks, the flow analysis needs a second engine — and two engines
// eventually disagree.

import { describe, expect, it } from 'vitest';

import {
  MILLISECONDS_PER_DAY,
  buildStateSegments,
  businessMillisBetween,
  resolveTimelineOriginMs,
} from './issueTimeline.ts';

/** Stand-in for the flow analysis' holder identity — the object value type this must support. */
interface TestHolder { holderId: string | null; holderName: string }

const WED_01_JUL = Date.parse('2026-07-01T00:00:00.000Z');
const FRI_03_JUL = Date.parse('2026-07-03T00:00:00.000Z');
const MON_06_JUL = Date.parse('2026-07-06T00:00:00.000Z');
const WED_08_JUL = Date.parse('2026-07-08T00:00:00.000Z');

describe('buildStateSegments — boolean values (the person-centric case)', () => {
  it('splits a timeline at each change', () => {
    const segments = buildStateSegments(WED_01_JUL, true, [{ atMs: FRI_03_JUL, value: false }], WED_08_JUL);

    expect(segments).toEqual([
      { startMs: WED_01_JUL, endMs: FRI_03_JUL, value: true },
      { startMs: FRI_03_JUL, endMs: WED_08_JUL, value: false },
    ]);
  });

  it('closes the final segment at today when nothing changes again', () => {
    const segments = buildStateSegments(WED_01_JUL, true, [], WED_08_JUL);

    expect(segments).toEqual([{ startMs: WED_01_JUL, endMs: WED_08_JUL, value: true }]);
  });
});

describe('buildStateSegments — object values (what the flow analysis needs)', () => {
  it('produces the same span structure for an assignee identity as it does for a boolean', () => {
    // The genericity this whole feature rests on. If this fails, the flow analysis would need its
    // own reconstruction — and two reconstructions of the same history eventually disagree.
    const jane: TestHolder = { holderId: 'jane', holderName: 'Jane Dev' };
    const unassigned: TestHolder = { holderId: null, holderName: 'Unassigned' };

    const segments = buildStateSegments(WED_01_JUL, jane, [{ atMs: FRI_03_JUL, value: unassigned }], WED_08_JUL);

    expect(segments).toEqual([
      { startMs: WED_01_JUL, endMs: FRI_03_JUL, value: jane },
      { startMs: FRI_03_JUL, endMs: WED_08_JUL, value: unassigned },
    ]);
  });

  it('carries an Unassigned holder through as a value, not as an absence', () => {
    const unassigned: TestHolder = { holderId: null, holderName: 'Unassigned' };

    const segments = buildStateSegments(WED_01_JUL, unassigned, [], WED_08_JUL);

    expect(segments[0].value).toEqual(unassigned);
  });
});

describe('buildStateSegments — boundaries', () => {
  it('clamps a change point before the origin rather than discarding it', () => {
    const beforeOrigin = WED_01_JUL - 5 * MILLISECONDS_PER_DAY;

    const segments = buildStateSegments(WED_01_JUL, true, [{ atMs: beforeOrigin, value: false }], WED_08_JUL);

    // The change still takes effect; it simply cannot start before the issue existed.
    expect(segments[0].startMs).toBe(WED_01_JUL);
    expect(segments[segments.length - 1].endMs).toBe(WED_08_JUL);
  });

  it('drops zero-length segments so two changes at one instant do not create an empty span', () => {
    const segments = buildStateSegments(WED_01_JUL, true, [
      { atMs: FRI_03_JUL, value: false },
      { atMs: FRI_03_JUL, value: true },
    ], WED_08_JUL);

    segments.forEach((segment) => expect(segment.endMs).toBeGreaterThan(segment.startMs));
  });

  it('never produces a segment ending after today', () => {
    const afterToday = WED_08_JUL + 10 * MILLISECONDS_PER_DAY;

    const segments = buildStateSegments(WED_01_JUL, true, [{ atMs: afterToday, value: false }], WED_08_JUL);

    segments.forEach((segment) => expect(segment.endMs).toBeLessThanOrEqual(WED_08_JUL));
  });
});

describe('businessMillisBetween', () => {
  it('counts Monday-to-Friday days only', () => {
    // Wed 1 Jul → Fri 3 Jul is two working days.
    expect(businessMillisBetween(WED_01_JUL, FRI_03_JUL) / MILLISECONDS_PER_DAY).toBeCloseTo(2, 10);
  });

  it('credits a weekend-only span zero working days', () => {
    const saturday = Date.parse('2026-07-04T00:00:00.000Z');
    const sunday = Date.parse('2026-07-05T00:00:00.000Z');

    expect(businessMillisBetween(saturday, sunday)).toBe(0);
  });

  it('excludes the weekend from a Friday-to-Monday span', () => {
    expect(businessMillisBetween(FRI_03_JUL, MON_06_JUL) / MILLISECONDS_PER_DAY).toBeCloseTo(1, 10);
  });

  it('never returns a negative', () => {
    expect(businessMillisBetween(WED_08_JUL, WED_01_JUL)).toBe(0);
  });
});

describe('resolveTimelineOriginMs', () => {
  it('anchors to the creation time when there is one', () => {
    expect(resolveTimelineOriginMs('2026-07-01T00:00:00.000Z', [], WED_08_JUL)).toBe(WED_01_JUL);
  });

  it('falls back to the earliest transition when creation is unknown', () => {
    expect(resolveTimelineOriginMs(null, ['2026-07-06T00:00:00.000Z', '2026-07-03T00:00:00.000Z'], WED_08_JUL))
      .toBe(FRI_03_JUL);
  });

  it('falls back to today when nothing dates the issue', () => {
    expect(resolveTimelineOriginMs(null, [], WED_08_JUL)).toBe(WED_08_JUL);
  });
});

describe('purity', () => {
  it('produces identical output for identical input', () => {
    const build = () => buildStateSegments(WED_01_JUL, 'a', [{ atMs: FRI_03_JUL, value: 'b' }], WED_08_JUL);

    expect(build()).toEqual(build());
  });

  it('does not mutate the change points it is given', () => {
    const changePoints = [{ atMs: FRI_03_JUL, value: false }];
    const snapshot = JSON.stringify(changePoints);

    buildStateSegments(WED_01_JUL, true, changePoints, WED_08_JUL);

    expect(JSON.stringify(changePoints)).toBe(snapshot);
  });
});
