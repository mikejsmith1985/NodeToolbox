// piPlanCarryover.test.ts — Carryover reconciliation (spec 032, Phase A): classify children, detect carryover,
// and gap-fill only the missing sub-tasks of in-flight Stories (never duplicate what exists).

import { describe, expect, it } from 'vitest';

import { classifyChildKind, isCarryoverFeature, reconcileCarryoverStory, reconcileCarryoverFeature, type CarryoverStory } from './piPlanCarryover.ts';
import type { ExistingChild } from './piPlanTypes.ts';

const resolveId = (repoName: string) => ({ 'enrollment-api': 'c1', 'enrollment-ui': 'c2' }[repoName] ?? null);

function child(kind: ExistingChild['kind'], summary: string): ExistingChild {
  return { key: 'K-1', kind, parentKey: 'S-1', summary };
}

describe('classifyChildKind', () => {
  it('maps summary prefixes to kinds', () => {
    expect(classifyChildKind('[SL] SL Test — X')).toBe('slTest');
    expect(classifyChildKind('[INT] Deploy — X')).toBe('deployInt');
    expect(classifyChildKind('[REL] Deploy — X')).toBe('deployRel');
    expect(classifyChildKind('[PROD] Deploy — X')).toBe('deployProd');
    expect(classifyChildKind('[enrollment-api] X')).toBe('coding');
    expect(classifyChildKind('No prefix here')).toBe('unknown');
  });
});

describe('isCarryoverFeature', () => {
  it('is carryover when a child Story exists', () => {
    expect(isCarryoverFeature([child('story', 'Some Story')])).toBe(true);
    expect(isCarryoverFeature([child('coding', '[api] x')])).toBe(false);
    expect(isCarryoverFeature([])).toBe(false);
  });
});

describe('reconcileCarryoverStory', () => {
  it('gap-fills only the missing sub-tasks, never duplicating existing ones', () => {
    // The Story covers api + ui; it already has an api coding sub-task and its SL test — so the gap is the
    // ui coding sub-task plus the INT/REL/PROD deploys.
    const story: CarryoverStory = {
      key: 'S-1', summary: 'Enrollment', repoNames: ['enrollment-api', 'enrollment-ui'],
      existingChildren: [child('coding', '[enrollment-api] Enrollment'), child('slTest', '[SL] SL Test — Enrollment')],
    };
    const { gapSubtasks } = reconcileCarryoverStory(story, resolveId);
    const kinds = gapSubtasks.map((subtask) => subtask.kind).sort();
    expect(kinds).toEqual(['coding', 'deployInt', 'deployProd', 'deployRel']);
    // The one coding gap is the uncovered repo (ui), not the already-present api.
    expect(gapSubtasks.find((subtask) => subtask.kind === 'coding')?.repo?.repoName).toBe('enrollment-ui');
  });

  it('yields no gaps for a fully-scaffolded Story', () => {
    const story: CarryoverStory = {
      key: 'S-2', summary: 'Done', repoNames: ['enrollment-api'],
      existingChildren: [
        child('coding', '[enrollment-api] Done'), child('slTest', '[SL] SL Test — Done'),
        child('deployInt', '[INT] Deploy — Done'), child('deployRel', '[REL] Deploy — Done'), child('deployProd', '[PROD] Deploy — Done'),
      ],
    };
    expect(reconcileCarryoverStory(story, resolveId).gapSubtasks).toHaveLength(0);
  });
});

describe('reconcileCarryoverFeature', () => {
  it('reconciles every Story and drops the fully-scaffolded ones', () => {
    const stories: CarryoverStory[] = [
      { key: 'S-1', summary: 'A', repoNames: ['enrollment-api'], existingChildren: [] }, // needs full scaffold
      {
        key: 'S-2', summary: 'B', repoNames: ['enrollment-api'],
        existingChildren: [
          child('coding', '[enrollment-api] B'), child('slTest', '[SL] SL Test — B'),
          child('deployInt', '[INT] Deploy — B'), child('deployRel', '[REL] Deploy — B'), child('deployProd', '[PROD] Deploy — B'),
        ],
      },
    ];
    const reconciled = reconcileCarryoverFeature(stories, resolveId);
    expect(reconciled.map((r) => r.storyKey)).toEqual(['S-1']); // S-2 fully scaffolded → dropped
  });
});
