// intakePoAnswers.test.ts — The PO's answers settle as the PO's, cascade applicability, and place lines exactly once.

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../sources/sourceModel.ts';
import type { EpicIntake, IntakeItem } from './epicIntakeModel.ts';
import {
  acceptDraft,
  acceptReviewedDrafts,
  answerDuplicate,
  answerKind,
  answerLabel,
  answerOwner,
  declineDraft,
  editDraft,
  isAwaitingLabel,
  placeLine,
} from './intakePoAnswers.ts';
import { proveLineCoverage } from './notesOutline.ts';
import { startEpicIntake } from './startIntake.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const DRAFT = { summary: 'S', description: 'Description:\nD', source: 'po' as const, editedByPo: false };

function startIntake(): EpicIntake {
  const source: ReferencedSource = { kind: 'paste', id: 'p', label: 'Notes', text: '•\tAlpha\no\tAlpha detail\n•\tBeta\n•\tGamma' };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: '2026-09-01T00:00:00.000Z', mintId: () => 'i' });
}

function findItem(intake: EpicIntake, title: string): IntakeItem {
  const item = intake.items.find((candidate) => candidate.title === title);
  if (item === undefined) throw new Error(title);
  return item;
}

/** Walks one item to a create-new verdict by PO answers. */
function answerToCreateNew(intake: EpicIntake, itemId: string): EpicIntake {
  const owned = answerOwner(answerKind(intake, itemId, 'work', NOW_ISO), itemId, 'enrollment', NOW_ISO);
  return answerDuplicate(owned, itemId, { verdict: 'createNew' }, NOW_ISO);
}

describe('closed-choice answers', () => {
  it('settles each answer as the PO\'s and stamps the time', () => {
    const intake = startIntake();
    const alphaId = findItem(intake, 'Alpha').id;
    const answered = answerKind(intake, alphaId, 'risk', NOW_ISO);
    expect(findItem(answered, 'Alpha').decisions.kind).toMatchObject({ state: 'settled', value: 'risk', settledBy: 'po' });
    expect(findItem(answered, 'Alpha').decisions.owner.state).toBe('notApplicable');
    expect(answered.updatedAtIso).toBe(NOW_ISO);
  });

  it('asks for a label only once the item is a new Epic, and settles it', () => {
    const intake = startIntake();
    const alphaId = findItem(intake, 'Alpha').id;
    const createNew = answerToCreateNew(intake, alphaId);
    expect(isAwaitingLabel(findItem(createNew, 'Alpha'))).toBe(true);
    const labelled = answerLabel(createNew, alphaId, 'Stability', NOW_ISO);
    expect(findItem(labelled, 'Alpha').decisions.label).toMatchObject({ value: 'Stability', settledBy: 'po' });
    expect(isAwaitingLabel(findItem(labelled, 'Alpha'))).toBe(false);
  });

  it('closes the label and draft when the PO picks an existing Epic', () => {
    const intake = startIntake();
    const alphaId = findItem(intake, 'Alpha').id;
    const owned = answerOwner(answerKind(intake, alphaId, 'work', NOW_ISO), alphaId, 'enrollment', NOW_ISO);
    const matched = answerDuplicate(owned, alphaId, { verdict: 'existing', key: 'DENP-632' }, NOW_ISO);
    expect(findItem(matched, 'Alpha').decisions.label.state).toBe('notApplicable');
  });

  it('ignores an answer for an unknown item', () => {
    const intake = startIntake();
    expect(answerKind(intake, 'item-99', 'work', NOW_ISO)).toBe(intake);
  });
});

describe('drafts', () => {
  it('marks an edited draft as the PO\'s', () => {
    const intake = startIntake();
    const alphaId = findItem(intake, 'Alpha').id;
    expect(findItem(editDraft(intake, alphaId, DRAFT, NOW_ISO), 'Alpha').draft?.editedByPo).toBe(true);
  });

  it('accepts or declines a draft', () => {
    const intake = answerToCreateNew(startIntake(), findItem(startIntake(), 'Alpha').id);
    const alphaId = findItem(intake, 'Alpha').id;
    expect(findItem(acceptDraft(intake, alphaId, DRAFT, NOW_ISO), 'Alpha')).toMatchObject({ draft: DRAFT, decisions: { draftAccepted: { value: 'accepted' } } });
    expect(findItem(declineDraft(intake, alphaId, NOW_ISO), 'Alpha').decisions.draftAccepted).toMatchObject({ value: 'declined', settledBy: 'po' });
  });
});

describe('acceptReviewedDrafts — what the Create click confirms', () => {
  function readyForReview(intake: EpicIntake, itemId: string): EpicIntake {
    const created = answerToCreateNew(intake, itemId);
    const searched = { ...created, items: created.items.map((item) => (item.id === itemId ? { ...item, searchStatus: 'ok' as const } : item)) };
    return answerLabel(searched, itemId, 'Roadmap', NOW_ISO);
  }

  it('accepts the written draft, and fills the template where there is none', () => {
    const intake = startIntake();
    const alphaId = findItem(intake, 'Alpha').id;
    const betaId = findItem(intake, 'Beta').id;
    const withDraft = editDraft(readyForReview(readyForReview(intake, alphaId), betaId), alphaId, DRAFT, NOW_ISO);

    const accepted = acceptReviewedDrafts(withDraft, false, NOW_ISO);

    expect(findItem(accepted, 'Alpha')).toMatchObject({ draft: { summary: 'S' }, decisions: { draftAccepted: { value: 'accepted', settledBy: 'po' } } });
    expect(findItem(accepted, 'Beta').draft?.summary).toBe('Beta');
    expect(findItem(accepted, 'Beta').decisions.draftAccepted).toMatchObject({ value: 'accepted' });
  });

  it('leaves declined and not-yet-ready items alone', () => {
    const intake = startIntake();
    const alphaId = findItem(intake, 'Alpha').id;
    const declined = declineDraft(readyForReview(intake, alphaId), alphaId, NOW_ISO);
    const accepted = acceptReviewedDrafts(declined, false, NOW_ISO);
    expect(findItem(accepted, 'Alpha').decisions.draftAccepted).toMatchObject({ value: 'declined' });
    expect(findItem(accepted, 'Gamma').decisions.draftAccepted.state).toBe('open');
  });
});

describe('placeLine', () => {
  it('moves a line into another item and keeps coverage whole', () => {
    const intake = startIntake();
    const detailLine = findItem(intake, 'Alpha').lineNumbers[1];
    const placed = placeLine(intake, detailLine, { itemId: findItem(intake, 'Beta').id }, NOW_ISO);
    expect(findItem(placed, 'Beta').lineNumbers).toContain(detailLine);
    expect(findItem(placed, 'Alpha').lineNumbers).not.toContain(detailLine);
    expect(proveLineCoverage(placed).isComplete).toBe(true);
  });

  it('sets a line aside as the PO\'s choice', () => {
    const intake = startIntake();
    const detailLine = findItem(intake, 'Alpha').lineNumbers[1];
    const placed = placeLine(intake, detailLine, { setAsideReason: 'contextOnly' }, NOW_ISO);
    expect(placed.setAsideLines).toContainEqual({ lineNumber: detailLine, reason: 'contextOnly', settledBy: 'po', note: null });
    expect(proveLineCoverage(placed).isComplete).toBe(true);
  });

  it('resolves a line held twice by keeping it only where the PO puts it', () => {
    const intake = startIntake();
    const detailLine = findItem(intake, 'Alpha').lineNumbers[1];
    const doubled = { ...intake, items: intake.items.map((item) => (item.title === 'Gamma' ? { ...item, lineNumbers: [...item.lineNumbers, detailLine] } : item)) };
    expect(proveLineCoverage(doubled).duplicated).toEqual([detailLine]);
    const placed = placeLine(doubled, detailLine, { itemId: findItem(intake, 'Alpha').id }, NOW_ISO);
    expect(proveLineCoverage(placed).isComplete).toBe(true);
  });

  it('refuses to leave an item with no lines', () => {
    const intake = startIntake();
    const gammaLine = findItem(intake, 'Gamma').lineNumbers[0];
    expect(placeLine(intake, gammaLine, { setAsideReason: 'notWork' }, NOW_ISO)).toBe(intake);
  });
});
