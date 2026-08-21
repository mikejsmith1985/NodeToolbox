// forecastAiAssist.test.ts — The AI writes prose. It cannot change a number.
//
// That is enforced by SHAPE, not by validation alone: an item has an id, a headline, prose and two
// lists of keys, and nowhere at all to put a figure. So a model that emits one has invented a
// property, and inventing a property is precisely how a figure would get changed.
//
// The other rejection is a model naming an issue or a person the prompt never mentioned. Both kinds
// are named rather than dropped — a reply that silently lost half its content is worse than one
// that plainly failed, because nobody would know to look.

import { describe, expect, it } from 'vitest';

import {
  buildForecastDailyPrompt,
  buildScopeCutPrompt,
  buildTestCapacityPrompt,
  parseForecastAiReply,
  stripAiAttribution,
} from './forecastAiAssist.ts';
import { buildForecastConfig } from '../forecastSettings.ts';
import { computeForecast } from '../forecastCompose.ts';
import type { CapacityAssessment, ForecastIssue, ForecastResult } from '../forecastTypes.ts';

const TODAY_ISO = '2026-08-20';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  TODAY_ISO,
).config;

function issue(overrides: Partial<ForecastIssue> = {}): ForecastIssue {
  return {
    key: 'ENC-1',
    summary: '[DEV] Build the thing',
    typeBucket: 'story',
    featureKey: 'DENP-1',
    columnId: '',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 10/02/2026'],
    storyPoints: 3,
    isComplete: false,
    actualStartIso: null,
    storedTargetStartIso: null,
    ...overrides,
  };
}

function forecastOf(items: ForecastIssue[]): ForecastResult {
  return computeForecast(
    {
      items,
      orderedColumnIds: [],
      fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }],
      people: [],
      piEndDate: '2026-11-06',
      hasSubStatusField: true,
      teamProfileId: 'team-a',
    },
    CONFIG,
  );
}

const SAMPLE_ASSESSMENT: CapacityAssessment = {
  window: { kind: 'to-code-freeze', startIso: '2026-08-20', endIso: '2026-09-11', workingDayCount: 17, hasPassed: false },
  personLoads: [{
    personKey: 'acct-1',
    displayName: 'Smith, Jane (CTR)',
    isOnRoster: true,
    inScopeWorkingDays: 22,
    totalAssignedWorkingDays: 30,
    availableWorkingDays: 17,
    overCapacityWorkingDays: 5,
    isOverCapacity: true,
    unsizedIssueCount: 0,
    inScopeIssueKeys: ['ENC-1'],
  }],
  unassignedWorkingDays: 0,
  unassignedIssueKeys: [],
  totalRemainingWorkingDays: 22,
  totalAvailableWorkingDays: 17,
  shortfallWorkingDays: 5,
  shouldRemoveScope: true,
  unsizedIssueCount: 1,
  undatedIssueCount: 2,
};

/** A minimal valid reply, so each test varies exactly the thing it is about. */
function replyWith(itemOverrides: Record<string, unknown> = {}, kind = 'forecastDaily'): string {
  return JSON.stringify({
    kind,
    items: [{
      id: 'a',
      headline: 'Two issues must start today',
      narrative: 'ENC-1 has to begin this morning.',
      issueKeys: ['ENC-1'],
      personKeys: ['Smith, Jane (CTR)'],
      ...itemOverrides,
    }],
  });
}

describe('the prompts', () => {
  it('names every issue in scope', () => {
    const prompt = buildForecastDailyPrompt(forecastOf([issue({ key: 'ENC-1' }), issue({ key: 'ENC-2' })]));
    expect(prompt).toContain('ENC-1');
    expect(prompt).toContain('ENC-2');
  });

  it('carries every computed figure verbatim, so the model has nothing to work out', () => {
    const prompt = buildForecastDailyPrompt(forecastOf([issue()]));
    const forecast = forecastOf([issue()]).issueForecasts[0];
    expect(prompt).toContain(forecast.state);
    expect(prompt).toContain(forecast.reason);
    expect(prompt).toContain(String(forecast.latestStartIso));
  });

  it('tells the model in plain words that it may invent nothing', () => {
    const prompt = buildForecastDailyPrompt(forecastOf([issue()]));
    expect(prompt).toMatch(/NOT NEGOTIABLE/);
    expect(prompt).toMatch(/Do not compute, adjust, re-estimate or invent/);
  });

  it('forbids the model attributing the text to itself', () => {
    expect(buildForecastDailyPrompt(forecastOf([issue()]))).toMatch(/Do not describe yourself/);
  });

  it('is byte-identical for the same input, so a prompt can be compared', () => {
    const result = forecastOf([issue()]);
    expect(buildForecastDailyPrompt(result)).toBe(buildForecastDailyPrompt(result));
  });

  it('says there is nothing to report rather than producing an empty prompt', () => {
    const prompt = buildForecastDailyPrompt(forecastOf([]));
    expect(prompt).toContain('no work in scope');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('spells out the reply shape and forbids any other property', () => {
    const prompt = buildForecastDailyPrompt(forecastOf([issue()]));
    expect(prompt).toContain('"kind":"forecastDaily"');
    expect(prompt).toMatch(/No other properties are permitted/);
  });

  it('gives the scope-cut prompt the shortfall and every person load', () => {
    const prompt = buildScopeCutPrompt(SAMPLE_ASSESSMENT, forecastOf([issue()]).issueForecasts);
    expect(prompt).toContain('Shortfall: 5d');
    expect(prompt).toContain('Smith, Jane (CTR)');
    expect(prompt).toContain('over by: 5d');
  });

  it('names what the totals could not see, so the narrative cannot overclaim', () => {
    const prompt = buildScopeCutPrompt(SAMPLE_ASSESSMENT, []);
    expect(prompt).toContain('1 unsized');
    expect(prompt).toContain('2 undated versions');
  });

  it('carries the ranked drop proposal instead of asking the model to invent one', () => {
    // The order is the team's, taken from their board. A model reordering it would be inventing a
    // priority nobody gave it, and the reply is meant to be executable rather than a second opinion.
    const prompt = buildScopeCutPrompt(SAMPLE_ASSESSMENT, [], {
      shortfallWorkingDays: 5,
      candidates: [{
        issueKey: 'ENC-9',
        summary: 'Lowest priority work',
        featureKey: 'DENP-9',
        featureRank: 9,
        assigneeDisplayName: 'Smith, Jane (CTR)',
        remainingWorkingDays: 5,
        state: 'on-track',
        remainingShortfallWorkingDays: 0,
      }],
      recoveredWorkingDays: 5,
      isStillShortAfterCut: false,
      unsizedIssueKeys: [],
    });

    expect(prompt).toContain('board rank ALREADY decides the drop order');
    expect(prompt).toContain('ENC-9');
    expect(prompt).toContain('rank 9');
    expect(prompt).toContain('closes the whole 5d shortfall');
  });

  it('asks for an executable plan, not a discussion', () => {
    const prompt = buildScopeCutPrompt(SAMPLE_ASSESSMENT, []);
    expect(prompt).toContain('EXECUTABLE course-correction plan');
    expect(prompt).toMatch(/which issue key/);
    expect(prompt).toMatch(/how many working days it recovers/);
  });

  it('offers re-assignment as an alternative to dropping work', () => {
    const prompt = buildScopeCutPrompt(SAMPLE_ASSESSMENT, []);
    expect(prompt).toMatch(/spare capacity/);
  });

  it('says plainly when dropping everything still leaves the release short', () => {
    const prompt = buildScopeCutPrompt(SAMPLE_ASSESSMENT, [], {
      shortfallWorkingDays: 20,
      candidates: [{
        issueKey: 'ENC-9',
        summary: 'Only droppable work',
        featureKey: null,
        featureRank: null,
        assigneeDisplayName: null,
        remainingWorkingDays: 4,
        state: 'behind',
        remainingShortfallWorkingDays: 16,
      }],
      recoveredWorkingDays: 4,
      isStillShortAfterCut: true,
      unsizedIssueKeys: [],
    });

    expect(prompt).toContain('recovers only 4d of the 20d needed');
  });

  it('says no cut is required when the work fits', () => {
    expect(buildScopeCutPrompt(SAMPLE_ASSESSMENT, [], null)).toContain('No cut is required');
  });

  it('asks the test-capacity prompt to weigh BOTH remedies', () => {
    const prompt = buildTestCapacityPrompt(SAMPLE_ASSESSMENT, []);
    expect(prompt).toMatch(/reduce scope, or add test resource/i);
  });
});

describe('the ingest', () => {
  const ALLOWED_ISSUES = ['ENC-1', 'ENC-2'];
  const ALLOWED_PEOPLE = ['Smith, Jane (CTR)'];

  it('keeps a reply that names only what the prompt supplied', () => {
    const ingest = parseForecastAiReply(replyWith(), 'forecastDaily', ALLOWED_ISSUES, ALLOWED_PEOPLE);
    expect(ingest.items).toHaveLength(1);
    expect(ingest.rejectedItems).toEqual([]);
  });

  it('rejects an item naming an issue the prompt never mentioned, and says which', () => {
    const ingest = parseForecastAiReply(
      replyWith({ issueKeys: ['FAKE-999'] }),
      'forecastDaily',
      ALLOWED_ISSUES,
      ALLOWED_PEOPLE,
    );
    expect(ingest.items).toEqual([]);
    expect(ingest.rejectedItems[0].reason).toContain('FAKE-999');
  });

  it('rejects an item naming somebody the prompt never mentioned', () => {
    const ingest = parseForecastAiReply(
      replyWith({ personKeys: ['Nobody, Real (CTR)'] }),
      'forecastDaily',
      ALLOWED_ISSUES,
      ALLOWED_PEOPLE,
    );
    expect(ingest.rejectedItems[0].reason).toContain('Nobody, Real (CTR)');
  });

  it('rejects an item carrying a day count, because the schema has nowhere to put one', () => {
    // The numeric guard. This is the case that stops the AI changing a figure.
    const ingest = parseForecastAiReply(
      replyWith({ days: 14 }),
      'forecastDaily',
      ALLOWED_ISSUES,
      ALLOWED_PEOPLE,
    );
    expect(ingest.items).toEqual([]);
    expect(ingest.rejectedItems[0].reason).toContain('days');
  });

  it('rejects an item carrying a date', () => {
    const ingest = parseForecastAiReply(
      replyWith({ targetStart: '2026-09-01' }),
      'forecastDaily',
      ALLOWED_ISSUES,
      ALLOWED_PEOPLE,
    );
    expect(ingest.rejectedItems[0].reason).toContain('targetStart');
  });

  it('rejects an item with nothing to say', () => {
    const ingest = parseForecastAiReply(
      replyWith({ narrative: '   ' }),
      'forecastDaily',
      ALLOWED_ISSUES,
      ALLOWED_PEOPLE,
    );
    expect(ingest.rejectedItems).toHaveLength(1);
  });

  it('keeps the good items when only some are bad, rather than discarding the reply', () => {
    // One silently dropped item is worse than a reply that failed, because nobody would look.
    const reply = JSON.stringify({
      kind: 'forecastDaily',
      items: [
        { id: 'good', headline: 'H', narrative: 'N', issueKeys: ['ENC-1'], personKeys: [] },
        { id: 'bad', headline: 'H', narrative: 'N', issueKeys: ['FAKE-1'], personKeys: [] },
      ],
    });
    const ingest = parseForecastAiReply(reply, 'forecastDaily', ALLOWED_ISSUES, ALLOWED_PEOPLE);
    expect(ingest.items.map((item) => item.id)).toEqual(['good']);
    expect(ingest.rejectedItems.map((rejected) => rejected.id)).toEqual(['bad']);
  });

  it('refuses a reply meant for a different narrative entirely', () => {
    expect(() => parseForecastAiReply(replyWith({}, 'forecastScopeCut'), 'forecastDaily', ALLOWED_ISSUES, ALLOWED_PEOPLE))
      .toThrow(/forecastScopeCut/);
  });

  it('gives a readable error rather than throwing raw when the reply is not JSON', () => {
    expect(() => parseForecastAiReply('sorry, I cannot help', 'forecastDaily', [], []))
      .toThrow(/No JSON object/);
  });

  it('parses a reply wrapped in a code fence', () => {
    const ingest = parseForecastAiReply(
      `Here you go:\n\`\`\`json\n${replyWith()}\n\`\`\`\nHope that helps.`,
      'forecastDaily',
      ALLOWED_ISSUES,
      ALLOWED_PEOPLE,
    );
    expect(ingest.items).toHaveLength(1);
  });

  it('names an item that has no id of its own, so a rejection is still actionable', () => {
    const reply = JSON.stringify({
      kind: 'forecastDaily',
      items: [{ headline: 'H', narrative: 'N', issueKeys: ['FAKE-1'], personKeys: [] }],
    });
    const ingest = parseForecastAiReply(reply, 'forecastDaily', ALLOWED_ISSUES, ALLOWED_PEOPLE);
    expect(ingest.rejectedItems[0].id).toBe('item 1');
  });
});

describe('stripAiAttribution', () => {
  it('removes the self-description clause while keeping everything after it', () => {
    // Only the clause. Taking the whole sentence would delete real findings that happen to share
    // one with the attribution — and then the item would be rejected for being empty.
    expect(stripAiAttribution('As an AI, I would suggest this. ENC-1 must start today.'))
      .toBe('I would suggest this. ENC-1 must start today.');
  });

  it('keeps a finding that shares its sentence with the attribution', () => {
    expect(stripAiAttribution('As an AI, ENC-1 is late.')).toBe('ENC-1 is late.');
  });

  it('leaves a narrative that never mentioned an assistant alone', () => {
    expect(stripAiAttribution('ENC-1 must start today.')).toBe('ENC-1 must start today.');
  });

  it('is applied on ingest, so an attributed narrative is cleaned rather than rejected', () => {
    const ingest = parseForecastAiReply(
      replyWith({ narrative: 'As an AI, I note that ENC-1 is late.' }),
      'forecastDaily',
      ['ENC-1'],
      ['Smith, Jane (CTR)'],
    );
    expect(ingest.items[0].narrative).not.toMatch(/as an ai/i);
    expect(ingest.items[0].narrative).toContain('ENC-1');
  });
});
