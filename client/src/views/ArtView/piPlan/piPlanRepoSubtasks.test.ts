// piPlanRepoSubtasks.test.ts — The repo→sub-task scaffold (spec 032, US2, contract repo-subtask-generation.md).

import { describe, expect, it } from 'vitest';

import {
  buildRepoCodingSubtasks,
  partitionDevPoints,
  buildStorySubtaskScaffold,
  type StoryForRepoSubtasks,
} from './piPlanRepoSubtasks.ts';
import type { ExistingChild } from './piPlanTypes.ts';

const resolveId = (repoName: string): string | null => ({ 'enrollment-api': 'c1', 'enrollment-ui': 'c2', 'notify': 'c3' }[repoName] ?? null);

function story(devPoints: number, summary = 'Member enrollment enhancement'): StoryForRepoSubtasks {
  return { summary, devPoints };
}

describe('partitionDevPoints', () => {
  it('splits equally, at least 1 each, summing to the dev points', () => {
    expect(partitionDevPoints(9, 3)).toEqual([3, 3, 3]);
    const uneven = partitionDevPoints(10, 3);
    expect(uneven.reduce((sum, part) => sum + part, 0)).toBe(10);
    expect(Math.min(...uneven)).toBeGreaterThanOrEqual(1);
  });

  it('gives at least 1 point per repo even when dev points are fewer than repos', () => {
    expect(partitionDevPoints(2, 3)).toEqual([1, 1, 1]);
  });

  it('returns [] for zero repos', () => {
    expect(partitionDevPoints(9, 0)).toEqual([]);
  });
});

describe('buildRepoCodingSubtasks', () => {
  it('builds one coding sub-task per repo with resolved component id and partitioned points', () => {
    const subtasks = buildRepoCodingSubtasks(story(9), ['enrollment-api', 'enrollment-ui', 'notify'], resolveId, []);
    expect(subtasks).toHaveLength(3);
    expect(subtasks.map((s) => s.repoName)).toEqual(['enrollment-api', 'enrollment-ui', 'notify']);
    expect(subtasks.map((s) => s.repoComponentId)).toEqual(['c1', 'c2', 'c3']);
    expect(subtasks.reduce((sum, s) => sum + s.devPoints, 0)).toBe(9);
    expect(subtasks.every((s) => s.assignee === null)).toBe(true);
  });

  it('a single-repo Story yields exactly one coding sub-task (no explosion)', () => {
    expect(buildRepoCodingSubtasks(story(5), ['enrollment-api'], resolveId, [])).toHaveLength(1);
  });

  it('de-duplicates repo names case-insensitively and skips blanks', () => {
    const subtasks = buildRepoCodingSubtasks(story(6), ['enrollment-api', 'Enrollment-API', '', 'notify'], resolveId, []);
    expect(subtasks.map((s) => s.repoName)).toEqual(['enrollment-api', 'notify']);
  });

  it('is idempotent: a repo already covered by an existing child coding sub-task is skipped', () => {
    const existing: ExistingChild[] = [
      { key: 'DENP-9', kind: 'coding', parentKey: 'DENP-1', summary: '[enrollment-api] Member enrollment enhancement' },
    ];
    const subtasks = buildRepoCodingSubtasks(story(9), ['enrollment-api', 'enrollment-ui', 'notify'], resolveId, existing);
    expect(subtasks.map((s) => s.repoName)).toEqual(['enrollment-ui', 'notify']);
  });

  it('surfaces an unresolved repo id as null (never invents one)', () => {
    const subtasks = buildRepoCodingSubtasks(story(4), ['unknown-repo'], resolveId, []);
    expect(subtasks[0].repoComponentId).toBeNull();
  });

  it('zero repos yields zero coding sub-tasks (caller surfaces "map repos first")', () => {
    expect(buildRepoCodingSubtasks(story(5), [], resolveId, [])).toEqual([]);
  });
});

describe('buildStorySubtaskScaffold', () => {
  it('emits N coding + 1 SL-test + 3 deploys, titled by convention', () => {
    const scaffold = buildStorySubtaskScaffold(story(9), ['enrollment-api', 'enrollment-ui'], resolveId, []);
    const kinds = scaffold.map((item) => item.kind);
    expect(kinds.filter((k) => k === 'coding')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'slTest')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'deployInt')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'deployRel')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'deployProd')).toHaveLength(1);
    const codingTitles = scaffold.filter((i) => i.kind === 'coding').map((i) => i.summary);
    expect(codingTitles).toContain('[enrollment-api] Member enrollment enhancement');
    expect(scaffold.find((i) => i.kind === 'slTest')?.summary).toBe('[SL] SL Test — Member enrollment enhancement');
  });

  it('a multi-repo Defect follows the same scaffold (FR-004)', () => {
    const defect = buildStorySubtaskScaffold(story(6, 'Ingestion mismatch'), ['im-ingestion', 'preprocessor'], () => 'cid', []);
    expect(defect.filter((i) => i.kind === 'coding')).toHaveLength(2);
    expect(defect.filter((i) => i.kind === 'slTest')).toHaveLength(1);
  });

  it('zero repos yields only the SL-test + deploys (no coding) and a map-first honest state is the caller\'s job', () => {
    const scaffold = buildStorySubtaskScaffold(story(5), [], resolveId, []);
    expect(scaffold.filter((i) => i.kind === 'coding')).toHaveLength(0);
  });
});
