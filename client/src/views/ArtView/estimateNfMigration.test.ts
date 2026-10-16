// estimateNfMigration.test.ts — Moving each Epic's story points into Estimate (NF), then clearing story points.

import { describe, expect, it, vi } from 'vitest';

import {
  buildEstimateNfMigrationJql,
  planEstimateNfMigration,
  runEstimateNfMigration,
  type EstimateNfMigrationPlan,
} from './estimateNfMigration.ts';

const STORY_POINT_FIELD_IDS = ['customfield_20001', 'customfield_20002'];
const ESTIMATE_NF_FIELD_ID = 'customfield_11900';

/** An Epic as Jira returns it, with only the fields the plan reads. */
function buildEpic(issueKey: string, fields: Record<string, unknown>) {
  return { key: issueKey, fields: { summary: `${issueKey} summary`, ...fields } };
}

describe('planEstimateNfMigration', () => {
  it('moves story points into an empty Estimate (NF), clearing every field that held them', () => {
    expect(planEstimateNfMigration(buildEpic('DENP-1', { customfield_20001: { value: '8' }, customfield_20002: 8 }), STORY_POINT_FIELD_IDS, ESTIMATE_NF_FIELD_ID))
      .toEqual({
        issueKey: 'DENP-1', summary: 'DENP-1 summary', storyPointsValue: '8', estimateNfValue: '',
        storyPointFieldIdsToClear: ['customfield_20001', 'customfield_20002'], action: 'move',
      });
  });

  it('only clears story points when Estimate (NF) already holds the same value', () => {
    expect(planEstimateNfMigration(buildEpic('DENP-2', { customfield_20001: { value: '5' }, customfield_11900: 5 }), STORY_POINT_FIELD_IDS, ESTIMATE_NF_FIELD_ID).action)
      .toBe('clear');
  });

  it('never overwrites a different Estimate (NF) — that is a conflict for a person', () => {
    expect(planEstimateNfMigration(buildEpic('DENP-3', { customfield_20001: { value: '5' }, customfield_11900: 13 }), STORY_POINT_FIELD_IDS, ESTIMATE_NF_FIELD_ID).action)
      .toBe('conflict');
  });

  it('has nothing to do for an Epic without story points', () => {
    expect(planEstimateNfMigration(buildEpic('DENP-4', { customfield_11900: 3 }), STORY_POINT_FIELD_IDS, ESTIMATE_NF_FIELD_ID).action)
      .toBe('none');
  });
});

describe('buildEstimateNfMigrationJql', () => {
  it('finds the Epics your Product Owners own, in every PI', () => {
    expect(buildEstimateNfMigrationJql(['Smith, Pat'], 'customfield_10500', ['Epic']))
      .toBe('issuetype = "Epic" AND cf[10500] = "Smith, Pat" ORDER BY key');
    expect(buildEstimateNfMigrationJql(['jdoe', 'pat'], null, ['Feature', 'Epic']))
      .toBe('issuetype in ("Feature", "Epic") AND assignee in ("jdoe", "pat") ORDER BY key');
  });

  it('refuses an unscoped search', () => {
    expect(buildEstimateNfMigrationJql([], null, ['Epic'])).toBeNull();
  });
});

describe('runEstimateNfMigration', () => {
  const movePlan: EstimateNfMigrationPlan = {
    issueKey: 'DENP-1', summary: 'Epic', storyPointsValue: '8', estimateNfValue: '',
    storyPointFieldIdsToClear: ['customfield_20001'], action: 'move',
  };

  /** Writers that succeed, with Estimate (NF) reading back whatever was written. */
  function buildWriters(readBackValue = '8') {
    return {
      saveEstimateNf: vi.fn().mockResolvedValue(undefined),
      readEstimateNf: vi.fn().mockResolvedValue(readBackValue),
      clearStoryPoints: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('copies, confirms the copy by reading it back, and only then clears story points', async () => {
    const writers = buildWriters();
    const results = await runEstimateNfMigration([movePlan], writers);

    expect(writers.saveEstimateNf).toHaveBeenCalledWith('DENP-1', '8');
    expect(writers.readEstimateNf).toHaveBeenCalledWith('DENP-1');
    expect(writers.clearStoryPoints).toHaveBeenCalledWith('DENP-1', ['customfield_20001']);
    expect(results).toEqual([{ issueKey: 'DENP-1', outcome: 'moved', message: 'Moved 8 to Estimate (NF) and cleared story points.' }]);
  });

  it('leaves story points alone when the copy does not read back', async () => {
    const writers = buildWriters('');
    const results = await runEstimateNfMigration([movePlan], writers);

    expect(writers.clearStoryPoints).not.toHaveBeenCalled();
    expect(results[0].outcome).toBe('failed');
    expect(results[0].message).toMatch(/did not read back/);
  });

  it('keeps going past a failed Epic and reports it', async () => {
    const writers = buildWriters();
    writers.saveEstimateNf.mockRejectedValueOnce(new Error('Field not on screen'));
    const results = await runEstimateNfMigration([movePlan, { ...movePlan, issueKey: 'DENP-2' }], writers);

    expect(results.map((result) => result.outcome)).toEqual(['failed', 'moved']);
    expect(results[0].message).toContain('Field not on screen');
  });

  it('clears story points without writing for a matching Epic, and skips conflicts and empty ones', async () => {
    const writers = buildWriters();
    const results = await runEstimateNfMigration([
      { ...movePlan, issueKey: 'DENP-2', estimateNfValue: '8', action: 'clear' },
      { ...movePlan, issueKey: 'DENP-3', estimateNfValue: '13', action: 'conflict' },
      { ...movePlan, issueKey: 'DENP-4', storyPointsValue: '', action: 'none' },
    ], writers);

    expect(writers.saveEstimateNf).not.toHaveBeenCalled();
    expect(writers.clearStoryPoints).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.outcome)).toEqual(['cleared', 'skipped', 'skipped']);
  });
});
