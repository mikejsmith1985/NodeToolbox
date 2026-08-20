// devSlChain.test.ts — Dev finishing on time is not the same as the Feature finishing on time.
//
// This is the failure the whole chain exists to catch: development lands exactly when it should, and
// the Feature still misses its PI commitment, because the test that has to follow it was never in
// anybody's plan. The dev work looks fine right up until the deadline.

import { describe, expect, it } from 'vitest';

import { classifyChainRole, scheduleDevSlChain } from './devSlChain.ts';
import { buildForecastConfig } from './forecastSettings.ts';
import type { ChainItem } from './forecastTypes.ts';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  '2026-08-20',
).config;

/** Monday, so a five-day week runs cleanly from it. */
const CHAIN_START = '2026-08-24';

function chainItem(overrides: Partial<ChainItem> = {}): ChainItem {
  return {
    issueKey: 'ENC-1',
    summary: '[DEV] Build it',
    role: 'dev',
    remainingWorkingDays: 3,
    isInternalTestReady: false,
    isComplete: false,
    ...overrides,
  };
}

describe('classifyChainRole', () => {
  it('reads the [SL] prefix', () => {
    expect(classifyChainRole({ summary: '[SL] Verify enrolment', assigneeCanInternalTest: null })).toBe('sl');
  });

  it('reads the [DEV] prefix', () => {
    expect(classifyChainRole({ summary: '[DEV] Build the API', assigneeCanInternalTest: null })).toBe('dev');
  });

  it('ignores casing and leading space, because summaries are typed by people', () => {
    expect(classifyChainRole({ summary: '  [sl] verify', assigneeCanInternalTest: null })).toBe('sl');
  });

  it('requires the prefix to be bracketed and at the start', () => {
    // "Add SLA banner" must not read as a test story just because it contains the letters.
    expect(classifyChainRole({ summary: 'Add SLA banner', assigneeCanInternalTest: null })).toBe('unclassified');
    expect(classifyChainRole({ summary: 'Rework the [SL] harness', assigneeCanInternalTest: null }))
      .toBe('unclassified');
  });

  it('falls back to the assignee capability when no prefix is present', () => {
    expect(classifyChainRole({ summary: 'Verify enrolment', assigneeCanInternalTest: true })).toBe('sl');
    expect(classifyChainRole({ summary: 'Build the API', assigneeCanInternalTest: false })).toBe('dev');
  });

  it('lets the prefix beat the capability, because the prefix is a deliberate statement', () => {
    expect(classifyChainRole({ summary: '[DEV] Build it', assigneeCanInternalTest: true })).toBe('dev');
  });

  it('says UNCLASSIFIED rather than guessing when it has neither signal', () => {
    expect(classifyChainRole({ summary: 'Do the work', assigneeCanInternalTest: null })).toBe('unclassified');
  });
});

describe('scheduleDevSlChain', () => {
  it('starts SL after dev finishes, and dates the Feature from both', () => {
    // Two dev stories of 3 and 2 days from Monday: dev completes Friday 2026-08-28. SL starts the
    // next working day, Monday 2026-08-31, and its 2 days end Tuesday 2026-09-01.
    const schedule = scheduleDevSlChain([
      chainItem({ issueKey: 'ENC-1', remainingWorkingDays: 3 }),
      chainItem({ issueKey: 'ENC-2', remainingWorkingDays: 2 }),
      chainItem({ issueKey: 'ENC-3', summary: '[SL] Test it', role: 'sl', remainingWorkingDays: 2 }),
    ], CHAIN_START, CONFIG);

    expect(schedule.devCompleteIso).toBe('2026-08-28');
    expect(schedule.slStartIso).toBe('2026-08-31');
    expect(schedule.dodDateIso).toBe('2026-09-01');
  });

  it('sums several SL stories rather than running them at once', () => {
    // Summing is the safe direction for a deadline. Where they are held by different people, the
    // per-person capacity check is what surfaces the parallelism.
    const schedule = scheduleDevSlChain([
      chainItem({ remainingWorkingDays: 1 }),
      chainItem({ issueKey: 'S-1', role: 'sl', remainingWorkingDays: 1 }),
      chainItem({ issueKey: 'S-2', role: 'sl', remainingWorkingDays: 2 }),
      chainItem({ issueKey: 'S-3', role: 'sl', remainingWorkingDays: 1 }),
    ], CHAIN_START, CONFIG);

    expect(schedule.slWorkingDays).toBe(4);
  });

  it('starts the chain immediately when every dev story is already awaiting test', () => {
    const schedule = scheduleDevSlChain([
      chainItem({ isInternalTestReady: true }),
      chainItem({ issueKey: 'S-1', role: 'sl', remainingWorkingDays: 2 }),
    ], CHAIN_START, CONFIG);

    expect(schedule.devCompleteIso).toBe(CHAIN_START);
  });

  it('charges nothing for a dev story that is already finished', () => {
    const schedule = scheduleDevSlChain([
      chainItem({ isComplete: true, remainingWorkingDays: 0 }),
      chainItem({ issueKey: 'D-2', remainingWorkingDays: 2 }),
    ], CHAIN_START, CONFIG);

    expect(schedule.devCompleteIso).toBe('2026-08-25');
  });

  it('reports a Feature with no SL story rather than treating it as free', () => {
    // An absent test story is a gap, not a saving. Silently dating the Feature at dev completion
    // would report a commitment as met that nobody has tested.
    const schedule = scheduleDevSlChain([chainItem({ remainingWorkingDays: 3 })], CHAIN_START, CONFIG);

    expect(schedule.hasNoSlStory).toBe(true);
    expect(schedule.slWorkingDays).toBeNull();
    expect(schedule.dodDateIso).toBe(schedule.devCompleteIso);
  });

  it('needs no time for SL work that is already at Integration Test', () => {
    const schedule = scheduleDevSlChain([
      chainItem({ isInternalTestReady: true }),
      chainItem({ issueKey: 'S-1', role: 'sl', remainingWorkingDays: 0, isComplete: true }),
    ], CHAIN_START, CONFIG);

    expect(schedule.slWorkingDays).toBe(0);
    expect(schedule.dodDateIso).toBe(schedule.devCompleteIso);
  });

  it('schedules unclassified work as dev, and names it', () => {
    const schedule = scheduleDevSlChain([
      chainItem({ issueKey: 'ENC-9', summary: 'Do the work', role: 'unclassified', remainingWorkingDays: 2 }),
    ], CHAIN_START, CONFIG);

    expect(schedule.unclassifiedIssueKeys).toEqual(['ENC-9']);
    expect(schedule.devCompleteIso).toBe('2026-08-25');
  });

  it('refuses to date a chain containing work nobody sized', () => {
    // Guessing a size here would produce a Feature date that looks exactly like a real one.
    const schedule = scheduleDevSlChain([
      chainItem({ remainingWorkingDays: null }),
      chainItem({ issueKey: 'S-1', role: 'sl', remainingWorkingDays: 2 }),
    ], CHAIN_START, CONFIG);

    expect(schedule.devCompleteIso).toBeNull();
    expect(schedule.dodDateIso).toBeNull();
  });

  it('refuses to date the chain when the SL work is unsized', () => {
    const schedule = scheduleDevSlChain([
      chainItem({ remainingWorkingDays: 2 }),
      chainItem({ issueKey: 'S-1', role: 'sl', remainingWorkingDays: null }),
    ], CHAIN_START, CONFIG);

    expect(schedule.dodDateIso).toBeNull();
  });

  it('steps over weekends', () => {
    // Five days from Monday ends on Friday; six would cross into the next week.
    const schedule = scheduleDevSlChain([chainItem({ remainingWorkingDays: 6 })], CHAIN_START, CONFIG);
    expect(schedule.devCompleteIso).toBe('2026-08-31');
  });

  it('steps over holidays', () => {
    const holidayConfig = buildForecastConfig(
      { pointsPerWorkingDay: 1, holidayIsoDates: ['2026-08-26'], featureSizingTolerancePercent: 0 },
      '2026-08-20',
    ).config;
    const schedule = scheduleDevSlChain([chainItem({ remainingWorkingDays: 3 })], CHAIN_START, holidayConfig);
    expect(schedule.devCompleteIso).toBe('2026-08-27');
  });

  it('survives a Feature with no work under it at all', () => {
    const schedule = scheduleDevSlChain([], CHAIN_START, CONFIG);
    expect(schedule.devCompleteIso).toBe(CHAIN_START);
    expect(schedule.hasNoSlStory).toBe(true);
  });
});
