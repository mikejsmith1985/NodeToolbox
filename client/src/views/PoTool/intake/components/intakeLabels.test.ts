// intakeLabels.test.ts — Every intake label exists and none of them names the assistant (the no-AI copy scan).

import { describe, expect, it } from 'vitest';

import { INTAKE_STEP_ORDER, ITEM_KINDS, ITEM_OWNERS, SET_ASIDE_REASONS } from '../epicIntakeModel.ts';
import { INTAKE_STEP_LABELS, ITEM_KIND_LABELS, ITEM_OWNER_LABELS, SET_ASIDE_REASON_LABELS, SETTLED_BY_LABELS } from './intakeLabels.ts';

describe('intake labels', () => {
  it('labels every step, kind, owner and set-aside reason', () => {
    expect(INTAKE_STEP_ORDER.every((step) => INTAKE_STEP_LABELS[step])).toBe(true);
    expect(ITEM_KINDS.every((kind) => ITEM_KIND_LABELS[kind])).toBe(true);
    expect(ITEM_OWNERS.every((owner) => ITEM_OWNER_LABELS[owner])).toBe(true);
    expect(SET_ASIDE_REASONS.every((reason) => SET_ASIDE_REASON_LABELS[reason])).toBe(true);
  });

  it('never names the assistant, prompts, replies or unlocking', () => {
    const allLabels = [INTAKE_STEP_LABELS, ITEM_KIND_LABELS, ITEM_OWNER_LABELS, SET_ASIDE_REASON_LABELS, SETTLED_BY_LABELS]
      .flatMap((labelMap) => Object.values(labelMap));
    for (const label of allLabels) {
      expect(label).not.toMatch(/\bAI\b|assistant|unlock|prompt|reply|⚡/i);
    }
  });
});
