// intakeDefaults.test.ts — With the assistant available the PO is never asked a question: exhausted answers get safe,
// flagged defaults and unclaimed lines are set aside (GH #387 feedback).

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../sources/sourceModel.ts';
import type { Decision, EpicIntake } from './epicIntakeModel.ts';
import { listOpenDecisions, MAX_AI_ATTEMPTS_PER_DECISION, recordAiRejection } from './intakeChecklist.ts';
import { applySafeDefaults } from './intakeDefaults.ts';
import { proveLineCoverage } from './notesOutline.ts';
import { startEpicIntake } from './startIntake.ts';

function startIntake(): EpicIntake {
  const source: ReferencedSource = { kind: 'paste', id: 'p', label: 'Notes', text: '•\tAlpha\no\tAlpha detail\n•\tBeta' };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: '2026-09-22T00:00:00.000Z', mintId: () => 'i' });
}

function exhaust<TValue>(decision: Decision<TValue>): Decision<TValue> {
  let current = decision;
  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS_PER_DECISION; attempt += 1) {
    current = recordAiRejection(current, 'unusable');
  }
  return current;
}

describe('applySafeDefaults', () => {
  it('answers every question the assistant exhausted, flagging each assumption, so nothing reaches the PO', () => {
    const intake = startIntake();
    const alpha = intake.items[0];
    const exhausted = {
      ...intake,
      items: [{ ...alpha, decisions: { ...alpha.decisions, kind: exhaust(alpha.decisions.kind) } }, intake.items[1]],
    };

    const defaulted = applySafeDefaults(exhausted, true);

    expect(defaulted.items[0].decisions.kind).toMatchObject({ state: 'settled', value: 'work', settledBy: 'rule' });
    expect(defaulted.items[0].reviewFlag).toMatch(/Assumed it is work/);
    expect(listOpenDecisions(defaulted, true).filter((openDecision) => openDecision.turn === 'po')).toEqual([]);
  });

  it('sets aside a line that no item claims any more', () => {
    const intake = startIntake();
    const alpha = intake.items[0];
    const droppedLine = alpha.lineNumbers[1];
    const regrouped = { ...intake, items: [{ ...alpha, lineNumbers: [alpha.lineNumbers[0]] }, intake.items[1]] };

    const defaulted = applySafeDefaults(regrouped, true);

    expect(proveLineCoverage(defaulted).isComplete).toBe(true);
    expect(defaulted.setAsideLines).toContainEqual(expect.objectContaining({ lineNumber: droppedLine, settledBy: 'rule' }));
  });

  it('changes nothing when the assistant is locked — the PO answers in the table then', () => {
    const intake = startIntake();
    expect(applySafeDefaults(intake, false)).toBe(intake);
  });

  it('leaves questions the assistant can still answer for the next request', () => {
    const intake = startIntake();
    expect(applySafeDefaults(intake, true).items[0].decisions.kind.state).toBe('open');
  });
});
