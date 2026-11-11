// intakeStepAnswer.test.ts — One pasted answer is read through the round it was asked in, and comes back with the
// follow-up it calls for: none when complete, the table again when unreadable (GH #499).

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../../sources/sourceModel.ts';
import { startEpicIntake } from '../startIntake.ts';
import { buildClassifyRequests, CLASSIFY_REPLY_KIND } from './intakeClassifyRound.ts';
import { readStepAnswer } from './intakeStepAnswer.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function startIntake() {
  const source: ReferencedSource = { kind: 'paste', id: 'paste-1', label: 'Notes', text: '•\tPaperless Options' };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: NOW_ISO, mintId: () => 'intake-1' });
}

describe('readStepAnswer', () => {
  const intake = startIntake();
  const [request] = buildClassifyRequests(intake);

  it('applies a complete sorting answer and asks for nothing more', () => {
    const replyText = JSON.stringify({ kind: CLASSIFY_REPLY_KIND, items: [{ id: request.itemIds[0], kind: 'noise' }] });
    const { updated, followUpPrompt } = readStepAnswer(intake, replyText, request, true, NOW_ISO);
    expect(updated.roundHistory).toHaveLength(1);
    expect(followUpPrompt).toBe('');
  });

  it('changes no decision for an unreadable answer and asks the same chat for the table', () => {
    const { updated, followUpPrompt } = readStepAnswer(intake, 'It is probably Enrollment work.', request, true, NOW_ISO);
    expect(updated.items).toEqual(intake.items);
    expect(followUpPrompt).toContain('INTAKE_SORTING_TABLE:');
  });

  it('reads a resolve answer through the resolve round', () => {
    const { updated, followUpPrompt } = readStepAnswer(intake, 'nothing usable', { itemIds: [], partIndex: 0, partCount: 1 }, false, NOW_ISO);
    expect(updated.roundHistory[0].kind).toBe('epicIntakeResolve');
    expect(followUpPrompt).toContain('INTAKE_RESOLVE_TABLE:');
  });
});
