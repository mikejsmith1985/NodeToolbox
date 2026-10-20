// coachingNote.test.ts — Proves the Review job's coaching note coaches exactly the failing checks, in engine order, in
// plain English, and is honest about anything it could not check.

import { describe, expect, it } from 'vitest';

import {
  READINESS_ITEM_IDS,
  type ReadinessItem,
  type ReadinessItemId,
  type ReadinessItemState,
} from '../../views/SnowHub/guided/changeReadiness.ts';
import {
  buildCoachingMailto,
  buildCoachingNote,
  COACHING_PHRASES,
  renderCoachingNoteText,
  type CoachingChange,
} from './coachingNote.ts';

const CHANGE: CoachingChange = { number: 'CHG0012345', creatorName: 'Smith, Jane', shortDescription: 'Login page fix' };

// Internal names and rule ids that must never reach the creator.
const FORBIDDEN_TEXT_PATTERNS = [/u_[a-z]/, /cmdb_ci/, /customfield_/, /sys_id/, /formula card/i, /\bctask/i, /needsAction/, /couldNotCheck/];

function buildItem(id: ReadinessItemId, state: ReadinessItemState): ReadinessItem {
  return { id, label: `Label ${id}`, state, reason: `Reason ${id}`, action: null };
}

/** Every engine item done, except the ones given other states. */
function buildItems(overrides: Partial<Record<ReadinessItemId, ReadinessItemState>>): ReadinessItem[] {
  return READINESS_ITEM_IDS.map((itemId) => buildItem(itemId, overrides[itemId] ?? 'done'));
}

describe('COACHING_PHRASES', () => {
  it('covers every readiness item id the engine can produce', () => {
    for (const itemId of READINESS_ITEM_IDS) {
      const phrase = COACHING_PHRASES[itemId];
      expect(phrase, itemId).toBeDefined();
      expect(phrase.topic.trim(), itemId).not.toBe('');
      expect(phrase.missing.trim(), itemId).not.toBe('');
      expect(phrase.whyItMatters.trim(), itemId).not.toBe('');
      expect(phrase.goodExample.trim(), itemId).not.toBe('');
    }
  });

  it('never names a field or a rule id', () => {
    for (const itemId of READINESS_ITEM_IDS) {
      const phraseText = Object.values(COACHING_PHRASES[itemId]).join(' ');
      for (const forbiddenPattern of FORBIDDEN_TEXT_PATTERNS) expect(phraseText, itemId).not.toMatch(forbiddenPattern);
    }
  });
});

describe('buildCoachingNote', () => {
  it('coaches one item per needsAction, in engine order', () => {
    const items = buildItems({ formulaBackout: 'needsAction', owner: 'needsAction', outage: 'notApplicable' });

    const note = buildCoachingNote(items, CHANGE);

    expect(note.items.map((coachingItem) => coachingItem.itemId)).toEqual(['owner', 'formulaBackout']);
    expect(note.items[0].missing).toBe(COACHING_PHRASES.owner.missing);
    expect(note.isReady).toBe(false);
  });

  it('lists could-not-check items only as not checked, never coached', () => {
    const items = buildItems({ testEvidence: 'couldNotCheck', prbs: 'needsAction' });

    const note = buildCoachingNote(items, CHANGE);

    expect(note.items.map((coachingItem) => coachingItem.itemId)).toEqual(['prbs']);
    expect(note.notCheckedLabels).toEqual([COACHING_PHRASES.testEvidence.topic]);
  });

  it('is ready with no coaching items when everything passes', () => {
    const note = buildCoachingNote(buildItems({ rcp: 'notApplicable' }), CHANGE);

    expect(note.isReady).toBe(true);
    expect(note.items).toEqual([]);
    expect(note.notCheckedLabels).toEqual([]);
  });
});

describe('renderCoachingNoteText', () => {
  it('greets the creator, numbers the items, and leaves the sign-off for the reviewer', () => {
    const noteText = renderCoachingNoteText(buildCoachingNote(buildItems({ owner: 'needsAction', formulaTesting: 'needsAction' }), CHANGE));

    expect(noteText.startsWith('Hi Smith, Jane,')).toBe(true);
    expect(noteText).toContain('CHG0012345');
    expect(noteText).toContain(`1. ${COACHING_PHRASES.owner.missing}`);
    expect(noteText).toContain(`2. ${COACHING_PHRASES.formulaTesting.missing}`);
    expect(noteText).toContain(COACHING_PHRASES.formulaTesting.goodExample);
    expect(noteText.trimEnd().endsWith('Thanks,')).toBe(true);
  });

  it('says honestly what could not be checked', () => {
    const noteText = renderCoachingNoteText(buildCoachingNote(buildItems({ ctaskDates: 'couldNotCheck' }), CHANGE));

    expect(noteText).toContain(`We couldn't check: ${COACHING_PHRASES.ctaskDates.topic}`);
    expect(noteText).not.toContain('ready for approval');
  });

  it('writes a short ready note when everything passes', () => {
    const noteText = renderCoachingNoteText(buildCoachingNote(buildItems({}), CHANGE));

    expect(noteText).toContain('ready for approval');
    expect(noteText).not.toMatch(/^1\./m);
  });

  it('greets without a name when the creator is unknown', () => {
    const noteText = renderCoachingNoteText(buildCoachingNote(buildItems({}), { ...CHANGE, creatorName: '' }));

    expect(noteText.startsWith('Hello,')).toBe(true);
  });

  it('never shows a field name or rule id, whatever fails', () => {
    const everyItemFailing = buildItems(Object.fromEntries(READINESS_ITEM_IDS.map((itemId) => [itemId, 'needsAction'])));
    const noteText = renderCoachingNoteText(buildCoachingNote(everyItemFailing, CHANGE));

    for (const forbiddenPattern of FORBIDDEN_TEXT_PATTERNS) expect(noteText).not.toMatch(forbiddenPattern);
  });
});

describe('buildCoachingMailto', () => {
  it('addresses the requester with the agreed subject and the note as the body', () => {
    const mailtoUrl = buildCoachingMailto('CHG0012345', 'Hi Jane,\n\nFix it.', 'jane.smith@example.com');

    expect(mailtoUrl.startsWith('mailto:jane.smith%40example.com?')).toBe(true);
    const query = new URLSearchParams(mailtoUrl.split('?')[1]);
    expect(query.get('subject')).toBe('CHG0012345 — changes needed before approval');
    expect(query.get('body')).toBe('Hi Jane,\n\nFix it.');
  });

  it('adds the CHG prefix when the number lacks it, and leaves the address blank when unknown', () => {
    const mailtoUrl = buildCoachingMailto('0012345', 'Note', '');

    expect(mailtoUrl.startsWith('mailto:?')).toBe(true);
    expect(new URLSearchParams(mailtoUrl.split('?')[1]).get('subject')).toBe('CHG 0012345 — changes needed before approval');
  });

  it('encodes spaces as %20 so mail clients do not show plus signs', () => {
    expect(buildCoachingMailto('CHG1', 'a b', '')).toContain('body=a%20b');
  });
});
