// taskPlacement.test.ts — Proves a task's place in its window is read from the AI's words, cleaned when stored, and its
// "not before" time lands on the right day and clock (GH #475: "after 5:00 CST" was ignored).

import { describe, expect, it } from 'vitest';

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import {
  convertClockBetweenZones, describeTaskPlacement, readPlacementCell, readTaskPlacement, resolveNotBeforeDate, type PlacementReadContext,
} from './taskPlacement.ts';

const CONTEXT: PlacementReadContext = {
  findTaskTitle: (namingText) => ({ T1: 'Approve and deploy', T2: 'Reprocess feedback file' } as Record<string, string>)[namingText.toUpperCase()],
  windowZone: 'America/New_York',
  windowDate: '2026-10-23T20:00',
};

describe('readPlacementCell', () => {
  it('reads stand-by, alongside and in-order cells, and nothing from a reason', () => {
    expect(readPlacementCell('whole window', CONTEXT)).toEqual({ runMode: 'wholeWindow' });
    expect(readPlacementCell('Stand-by (awareness only)', CONTEXT)).toEqual({ runMode: 'wholeWindow' });
    expect(readPlacementCell('with T1', CONTEXT)).toEqual({ runMode: 'alongside', alongsideTaskTitle: 'Approve and deploy' });
    expect(readPlacementCell('in parallel with T2', CONTEXT)).toEqual({ runMode: 'alongside', alongsideTaskTitle: 'Reprocess feedback file' });
    expect(readPlacementCell('in order', CONTEXT)).toEqual({ runMode: 'inOrder' });
    expect(readPlacementCell('standard deployment with release review', CONTEXT)).toBeNull();
    expect(readPlacementCell('with T9', CONTEXT)).toBeNull();
  });

  it('moves a "not before" time stated in Central onto the window\'s Eastern clock, reading am/pm', () => {
    expect(readPlacementCell('in order; not before 17:00 CST', CONTEXT)).toEqual({ runMode: 'inOrder', notBeforeTime: '18:00' });
    expect(readPlacementCell('not before 5 PM CT', CONTEXT)).toEqual({ runMode: 'inOrder', notBeforeTime: '18:00' });
    expect(readPlacementCell('with T1; not before 21:30', CONTEXT)).toEqual({ runMode: 'alongside', alongsideTaskTitle: 'Approve and deploy', notBeforeTime: '21:30' });
  });
});

describe('convertClockBetweenZones', () => {
  it('follows daylight saving on the day and wraps past midnight', () => {
    expect(convertClockBetweenZones('17:00', 'America/Chicago', 'America/New_York', '2026-10-23')).toBe('18:00');
    expect(convertClockBetweenZones('23:30', 'America/New_York', 'UTC', '2026-12-01')).toBe('04:30');
    expect(convertClockBetweenZones('17:00', 'UTC', 'UTC', '2026-10-23')).toBe('17:00');
  });
});

describe('resolveNotBeforeDate', () => {
  it('holds a task to the time on the window\'s first day, or the next day inside a window past midnight', () => {
    expect(resolveNotBeforeDate('22:00', '2026-10-23T20:00', '2026-10-24T05:00')).toBe('2026-10-23T22:00');
    expect(resolveNotBeforeDate('00:30', '2026-10-23T22:00', '2026-10-24T02:00')).toBe('2026-10-24T00:30');
  });

  it('is already met when the window starts after the time, and absent for no time', () => {
    expect(resolveNotBeforeDate('17:00', '2026-10-23T20:00', '2026-10-24T05:00')).toBeNull();
    expect(resolveNotBeforeDate(undefined, '2026-10-23T20:00', '')).toBeNull();
    expect(resolveNotBeforeDate('17:00', '', '')).toBeNull();
  });
});

describe('readTaskPlacement', () => {
  const withPlacement = (timelinePlacement: unknown) => ({ timelinePlacement } as CtaskTemplate);

  it('defaults to one after another, and drops a malformed time or an alongside with no partner', () => {
    expect(readTaskPlacement({} as CtaskTemplate)).toEqual({ runMode: 'inOrder' });
    expect(readTaskPlacement(withPlacement({ runMode: 'sideways' }))).toEqual({ runMode: 'inOrder' });
    expect(readTaskPlacement(withPlacement({ runMode: 'wholeWindow', notBeforeTime: '5pm' }))).toEqual({ runMode: 'wholeWindow' });
    expect(readTaskPlacement(withPlacement({ runMode: 'alongside', alongsideTaskTitle: ' ', notBeforeTime: '18:00' }))).toEqual({ runMode: 'inOrder', notBeforeTime: '18:00' });
  });

  it('says the placement in plain words, and nothing for the default', () => {
    expect(describeTaskPlacement({ runMode: 'inOrder' })).toBe('');
    expect(describeTaskPlacement({ runMode: 'alongside', alongsideTaskTitle: 'Deploy', notBeforeTime: '18:00' })).toBe('runs alongside “Deploy”, not before 18:00');
  });
});
