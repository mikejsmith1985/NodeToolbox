// releasePriorityApply.test.ts — Reading the ranking's signals and writing the order back, without Jira.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFieldMappingOverride } from '../../../services/jiraFieldMapping.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  buildKeysSearchPath,
  fetchReleasePriorityContext,
  readFieldText,
  resolveReleasePriorityFieldIds,
  writeStatusSummaryPlan,
  type ReleasePriorityFieldIds,
  type StatusSummaryWriters,
} from './releasePriorityApply.ts';

const FIELD_IDS: ReleasePriorityFieldIds = {
  statusSummaryFieldId: 'customfield_777',
  featureTargetEndFieldIds: ['customfield_888'],
};

function issueWithFields(key: string, fields: Record<string, unknown>): JiraIssue {
  return { id: key, key, fields } as unknown as JiraIssue;
}

describe('resolveReleasePriorityFieldIds', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reads both ids from the mapping, honouring a saved override', () => {
    writeFieldMappingOverride(localStorage, 'statusSummaryFieldId', 'customfield_5');

    const fieldIds = resolveReleasePriorityFieldIds(localStorage);

    expect(fieldIds.statusSummaryFieldId).toBe('customfield_5');
    expect(fieldIds.featureTargetEndFieldIds.length).toBeGreaterThan(0);
  });
});

describe('buildKeysSearchPath', () => {
  it('asks for exactly the given keys and fields, and no more results than keys', () => {
    const path = buildKeysSearchPath(['ENCUC-1', 'ENCUC-2'], ['created', 'duedate']);

    expect(path).toBe(
      `/rest/api/2/search?jql=${encodeURIComponent('key in ("ENCUC-1","ENCUC-2")')}&maxResults=2&fields=created,duedate`,
    );
  });
});

describe('readFieldText', () => {
  it('reads text, select options, named objects and numbers as one string', () => {
    expect(readFieldText(' 03 ')).toBe('03');
    expect(readFieldText({ value: '02' })).toBe('02');
    expect(readFieldText({ name: '2026-09-10' })).toBe('2026-09-10');
    expect(readFieldText(4)).toBe('4');
  });

  it('reads blank, null and the unexpected as nothing', () => {
    expect(readFieldText('')).toBeNull();
    expect(readFieldText(null)).toBeNull();
    expect(readFieldText(undefined)).toBeNull();
    expect(readFieldText(true)).toBeNull();
  });
});

describe('fetchReleasePriorityContext', () => {
  it('reads the issues and their Features in two requests, keyed for the prompt', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path.includes('fields=created')) {
        return {
          issues: [
            issueWithFields('ENCUC-1', { created: '2026-06-01T10:00:00.000Z', duedate: '2026-09-01', customfield_777: { value: '03' } }),
            issueWithFields('ENCUC-2', { created: null, duedate: null, customfield_777: null }),
          ],
        };
      }
      return {
        issues: [issueWithFields('FEAT-10', { duedate: '2026-09-30', customfield_888: '2026-09-10' })],
      };
    });

    const context = await fetchReleasePriorityContext(
      ['ENCUC-1', 'ENCUC-2'],
      ['FEAT-10'],
      FIELD_IDS,
      fetchJson as never,
    );

    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls[0][0]).toContain('fields=created,duedate,customfield_777');
    expect(fetchJson.mock.calls[1][0]).toContain('fields=duedate,customfield_888');
    expect(context.issueContextByKey.get('ENCUC-1')).toEqual({
      createdIso: '2026-06-01T10:00:00.000Z',
      dueDateIso: '2026-09-01',
      currentStatusSummary: '03',
    });
    expect(context.issueContextByKey.get('ENCUC-2')).toEqual({ createdIso: null, dueDateIso: null, currentStatusSummary: null });
    expect(context.featureContextByKey.get('FEAT-10')).toEqual({ targetEndIso: '2026-09-10', dueDateIso: '2026-09-30' });
  });

  it('makes no Feature request when the release has no Features', async () => {
    const fetchJson = vi.fn(async () => ({ issues: [] }));

    await fetchReleasePriorityContext(['ENCUC-1'], [], FIELD_IDS, fetchJson as never);

    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});

describe('writeStatusSummaryPlan', () => {
  const PLAN = [
    { issueKey: 'ENCUC-3', rank: 1, value: '01' },
    { issueKey: 'ENCUC-1', rank: 2, value: '02' },
    { issueKey: 'ENCUC-2', rank: 3, value: '03' },
  ];

  function buildWriters(overrides: Partial<StatusSummaryWriters> = {}): StatusSummaryWriters {
    return {
      readEditMeta: vi.fn(async () => ({})),
      writeSimple: vi.fn(async () => undefined),
      writeOption: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('writes plain text, one issue at a time, top of the list first', async () => {
    const callOrder: string[] = [];
    const writers = buildWriters({
      writeSimple: vi.fn(async (issueKey: string) => { callOrder.push(issueKey); }),
    });

    const outcomes = await writeStatusSummaryPlan(PLAN, 'customfield_777', undefined, writers);

    expect(callOrder).toEqual(['ENCUC-3', 'ENCUC-1', 'ENCUC-2']);
    expect(writers.writeSimple).toHaveBeenCalledWith('ENCUC-3', 'customfield_777', '01');
    expect(writers.writeOption).not.toHaveBeenCalled();
    expect(outcomes.every((outcome) => outcome.isWritten)).toBe(true);
  });

  it('writes as a select option when the edit screen says the field has allowed values', async () => {
    const selectMeta = { allowedValues: [{ id: '10', value: '01' }, { id: '11', value: '02' }, { id: '12', value: '03' }] };
    const writers = buildWriters({
      readEditMeta: vi.fn(async () => ({ customfield_777: selectMeta })),
    });

    await writeStatusSummaryPlan(PLAN, 'customfield_777', undefined, writers);

    expect(writers.readEditMeta).toHaveBeenCalledTimes(1);
    expect(writers.writeOption).toHaveBeenCalledWith('ENCUC-3', 'customfield_777', '01', selectMeta);
    expect(writers.writeSimple).not.toHaveBeenCalled();
  });

  it('still writes as text when the edit screen cannot be read', async () => {
    const writers = buildWriters({
      readEditMeta: vi.fn(async () => { throw new Error('403'); }),
    });

    const outcomes = await writeStatusSummaryPlan(PLAN, 'customfield_777', undefined, writers);

    expect(writers.writeSimple).toHaveBeenCalledTimes(3);
    expect(outcomes.every((outcome) => outcome.isWritten)).toBe(true);
  });

  it('continues past a failure and names the row that failed', async () => {
    const reported: string[] = [];
    const writers = buildWriters({
      writeSimple: vi.fn(async (issueKey: string) => {
        if (issueKey === 'ENCUC-1') throw new Error('Field cannot be set');
      }),
    });

    const outcomes = await writeStatusSummaryPlan(
      PLAN,
      'customfield_777',
      (outcome) => reported.push(`${outcome.issueKey}:${outcome.isWritten ? 'ok' : 'fail'}`),
      writers,
    );

    expect(reported).toEqual(['ENCUC-3:ok', 'ENCUC-1:fail', 'ENCUC-2:ok']);
    expect(outcomes[1]).toEqual({ issueKey: 'ENCUC-1', value: '02', isWritten: false, errorMessage: 'Field cannot be set' });
  });

  it('touches nothing for an empty plan', async () => {
    const writers = buildWriters();

    expect(await writeStatusSummaryPlan([], 'customfield_777', undefined, writers)).toEqual([]);
    expect(writers.readEditMeta).not.toHaveBeenCalled();
  });
});
