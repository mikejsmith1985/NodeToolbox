// piReviewDeliveryDates.test.ts — Unit tests for the pure PI Review delivery-milestone derivation
// (Dev Start / Dev Test / INT/PVS / Prod Deploy), shared by the browser tab and the server scheduler.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEV_START_STATUS_NAME,
  DEV_TEST_EXEMPT_VALUE,
  buildPiReviewChildStoryJql,
  buildStatusCategoryMap,
  collectDeliverySubtaskKeys,
  derivePiReviewDeliveryDates,
  derivePiReviewDeliveryDatesByFeature,
} from './piReviewDeliveryDates.ts';

/** Builds a minimal changelog history entry: one status change at the given instant. */
function makeStatusHistory(atIso: string, fromStatus: string, toStatus: string) {
  return {
    created: atIso,
    items: [{ field: 'status', fromString: fromStatus, toString: toStatus }],
  };
}

/** Builds a minimal issue with a status changelog, current status, and optional extras. */
function makeIssue(
  key: string,
  options: {
    summary?: string;
    statusName?: string;
    created?: string;
    resolutionDate?: string | null;
    parentKey?: string;
    fixVersions?: Array<{ name?: string; releaseDate?: string }>;
    histories?: Array<{ created?: string; items?: Array<Record<string, unknown>> }>;
    extraFields?: Record<string, unknown>;
  } = {},
) {
  return {
    key,
    fields: {
      summary: options.summary ?? '',
      created: options.created ?? '2026-01-01T09:00:00.000-0500',
      status: { name: options.statusName ?? 'To Do' },
      resolutiondate: options.resolutionDate ?? null,
      parent: options.parentKey ? { key: options.parentKey } : null,
      fixVersions: options.fixVersions ?? [],
      ...(options.extraFields ?? {}),
    },
    changelog: { histories: options.histories ?? [] },
  };
}

const STATUS_CATEGORIES = buildStatusCategoryMap([
  { name: 'To Do', statusCategory: { key: 'new' } },
  { name: 'Working', statusCategory: { key: 'indeterminate' } },
  { name: 'Implementing', statusCategory: { key: 'indeterminate' } },
  { name: 'Done', statusCategory: { key: 'done' } },
  { name: 'Cancelled', statusCategory: { key: 'done' } },
]);

describe('buildStatusCategoryMap', () => {
  it('maps status names to category keys case-insensitively', () => {
    expect(STATUS_CATEGORIES.working).toBe('indeterminate');
    expect(STATUS_CATEGORIES.done).toBe('done');
  });

  it('ignores malformed status entries instead of throwing', () => {
    expect(buildStatusCategoryMap([{ name: '' }, {}, { name: 'Ok', statusCategory: { key: 'new' } }])).toEqual({ ok: 'new' });
  });
});

describe('buildPiReviewChildStoryJql', () => {
  it('queries every feature-link candidate field with an epic-link fallback', () => {
    const jql = buildPiReviewChildStoryJql(['DENP-1', 'DENP-2'], 'customfield_10108');
    expect(jql).toContain('cf[10108] in (DENP-1,DENP-2)');
    expect(jql).toContain('cf[10014] in (DENP-1,DENP-2)');
    expect(jql).toContain(' OR ');
  });

  it('returns an empty string when there are no feature keys', () => {
    expect(buildPiReviewChildStoryJql([], 'customfield_10108')).toBe('');
  });
});

describe('collectDeliverySubtaskKeys', () => {
  it('collects only [SL] and [INT] sub-task stubs from the stories', () => {
    const stories = [
      {
        key: 'ST-1',
        fields: {
          summary: 'Story one',
          subtasks: [
            { key: 'SUB-1', fields: { summary: '[SL] SL Test: story one' } },
            { key: 'SUB-2', fields: { summary: '[INT] Deploy: story one' } },
            { key: 'SUB-3', fields: { summary: '[REL] Deploy: story one' } },
            { key: 'SUB-4', fields: { summary: 'Plain sub-task' } },
          ],
        },
      },
    ];
    expect(collectDeliverySubtaskKeys(stories)).toEqual(['SUB-1', 'SUB-2']);
  });
});

describe('derivePiReviewDeliveryDates', () => {
  it('reads Dev Start from the first transition into the dev-start status', () => {
    const featureIssue = makeIssue('DENP-1', {
      statusName: 'Done',
      histories: [
        makeStatusHistory('2026-02-03T10:00:00.000-0500', 'To Do', 'Implementing'),
        makeStatusHistory('2026-03-01T10:00:00.000-0500', 'Implementing', 'Done'),
        // A later re-entry must not move the start date backwards in time.
        makeStatusHistory('2026-03-10T10:00:00.000-0500', 'Done', 'Implementing'),
      ],
    });
    const dates = derivePiReviewDeliveryDates({
      featureIssue,
      subtaskIssues: [],
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devStart).toBe('2026-02-03');
  });

  it('falls back to the created date when the feature sits in the dev-start status with no transition', () => {
    const featureIssue = makeIssue('DENP-1', {
      statusName: 'Implementing',
      created: '2026-01-15T08:00:00.000-0500',
      histories: [],
    });
    const dates = derivePiReviewDeliveryDates({
      featureIssue,
      subtaskIssues: [],
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devStart).toBe('2026-01-15');
  });

  it('leaves Dev Start empty when the feature never entered the dev-start status', () => {
    const featureIssue = makeIssue('DENP-1', { statusName: 'To Do', histories: [] });
    const dates = derivePiReviewDeliveryDates({
      featureIssue,
      subtaskIssues: [],
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devStart).toBeNull();
  });

  it('reads Dev Test from the earliest [SL] sub-task entering an in-progress status', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', {
        summary: '[SL] SL Test: story one',
        statusName: 'Done',
        histories: [makeStatusHistory('2026-02-20T09:00:00.000-0500', 'To Do', 'Working')],
      }),
      makeIssue('SUB-2', {
        summary: '[SL] SL Test: story two',
        statusName: 'Working',
        histories: [makeStatusHistory('2026-02-12T09:00:00.000-0500', 'To Do', 'Working')],
      }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devTest).toBe('2026-02-12');
  });

  it('marks Dev Test EXEMPT when every [SL] sub-task sits cancelled and none ever started', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', { summary: '[SL] SL Test: story one', statusName: 'Cancelled' }),
      makeIssue('SUB-2', { summary: '[SL] SL Test: story two', statusName: 'Cancelled' }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devTest).toBe(DEV_TEST_EXEMPT_VALUE);
  });

  it('prefers a real Dev Test start date over the cancelled EXEMPT mark', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', {
        summary: '[SL] SL Test: story one',
        statusName: 'Cancelled',
        histories: [makeStatusHistory('2026-02-12T09:00:00.000-0500', 'To Do', 'Working')],
      }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devTest).toBe('2026-02-12');
  });

  it('leaves Dev Test blank when some [SL] sub-tasks are cancelled but others have not started', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', { summary: '[SL] SL Test: story one', statusName: 'Cancelled' }),
      makeIssue('SUB-2', { summary: '[SL] SL Test: story two', statusName: 'To Do' }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.devTest).toBeNull();
  });

  it('reads INT/PVS from the earliest [INT] sub-task entering a done-category status', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', {
        summary: '[INT] Deploy: story one',
        statusName: 'Done',
        histories: [
          makeStatusHistory('2026-02-25T09:00:00.000-0500', 'To Do', 'Working'),
          makeStatusHistory('2026-02-27T09:00:00.000-0500', 'Working', 'Done'),
        ],
      }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.intPvs).toBe('2026-02-27');
  });

  it('never treats a cancelled [INT] sub-task as a deploy even though Cancelled is done-category', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', {
        summary: '[INT] Deploy: story one',
        statusName: 'Cancelled',
        histories: [makeStatusHistory('2026-02-27T09:00:00.000-0500', 'To Do', 'Cancelled')],
      }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.intPvs).toBeNull();
  });

  it('falls back to the [INT] resolution date when the changelog carries no done transition', () => {
    const subtaskIssues = [
      makeIssue('SUB-1', {
        summary: '[INT] Deploy: story one',
        statusName: 'Done',
        resolutionDate: '2026-03-02T12:00:00.000-0500',
        histories: [],
      }),
    ];
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues,
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.intPvs).toBe('2026-03-02');
  });

  it('reads Prod Deploy from the earliest dated fixVersion', () => {
    const featureIssue = makeIssue('DENP-1', {
      fixVersions: [
        { name: 'Release 26.4', releaseDate: '2026-04-15' },
        { name: 'Release 26.3', releaseDate: '2026-03-20' },
        { name: 'Unscheduled' },
      ],
    });
    const dates = derivePiReviewDeliveryDates({
      featureIssue,
      subtaskIssues: [],
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates.prodDeploy).toBe('2026-03-20');
  });

  it('returns all-null milestones for a feature with no signals at all', () => {
    const dates = derivePiReviewDeliveryDates({
      featureIssue: makeIssue('DENP-1'),
      subtaskIssues: [],
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(dates).toEqual({ devStart: null, devTest: null, intPvs: null, prodDeploy: null });
  });
});

describe('derivePiReviewDeliveryDatesByFeature', () => {
  it('chains sub-task → story → feature through the feature-link field', () => {
    const featureIssuesByKey = {
      'DENP-1': makeIssue('DENP-1', {
        statusName: 'Implementing',
        histories: [makeStatusHistory('2026-02-01T09:00:00.000-0500', 'To Do', 'Implementing')],
      }),
      'DENP-2': makeIssue('DENP-2'),
    };
    const storyIssues = [
      makeIssue('ST-1', { extraFields: { customfield_10108: 'DENP-1' } }),
      makeIssue('ST-2', { extraFields: { customfield_10108: 'DENP-2' } }),
    ];
    const subtaskIssues = [
      makeIssue('SUB-1', {
        summary: '[SL] SL Test: story one',
        statusName: 'Working',
        parentKey: 'ST-1',
        histories: [makeStatusHistory('2026-02-10T09:00:00.000-0500', 'To Do', 'Working')],
      }),
      makeIssue('SUB-2', {
        summary: '[INT] Deploy: story two',
        statusName: 'Done',
        parentKey: 'ST-2',
        histories: [makeStatusHistory('2026-02-14T09:00:00.000-0500', 'Working', 'Done')],
      }),
    ];

    const datesByFeature = derivePiReviewDeliveryDatesByFeature({
      featureIssuesByKey,
      storyIssues,
      subtaskIssues,
      featureLinkFieldId: 'customfield_10108',
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });

    expect(datesByFeature['DENP-1']).toEqual({ devStart: '2026-02-01', devTest: '2026-02-10', intPvs: null, prodDeploy: null });
    expect(datesByFeature['DENP-2']).toEqual({ devStart: null, devTest: null, intPvs: '2026-02-14', prodDeploy: null });
  });

  it('produces an entry for every feature so a fetched-but-quiet feature still clears stale cells', () => {
    const datesByFeature = derivePiReviewDeliveryDatesByFeature({
      featureIssuesByKey: { 'DENP-9': makeIssue('DENP-9') },
      storyIssues: [],
      subtaskIssues: [],
      featureLinkFieldId: 'customfield_10108',
      statusCategoryByName: STATUS_CATEGORIES,
      devStartStatusName: DEFAULT_DEV_START_STATUS_NAME,
    });
    expect(datesByFeature['DENP-9']).toEqual({ devStart: null, devTest: null, intPvs: null, prodDeploy: null });
  });
});
