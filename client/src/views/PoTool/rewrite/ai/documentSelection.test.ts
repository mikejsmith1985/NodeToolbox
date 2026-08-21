// documentSelection.test.ts — Asking which documents are needed before fetching any of them.
//
// A document library holds hundreds of files. Fetching all of them to find the three that matter
// would be slow, would blow every prompt budget, and would bury the useful material in the rest.
//
// So the round trip is in two halves: hand over the NAMES, get back a shortlist, fetch only those.
// The half that has to be strict is the second one — a name the assistant invented must be refused,
// because fetching it would either fail confusingly or, worse, match some other document.

import { describe, expect, it } from 'vitest';

import { buildDocumentSelectionPrompt, parseDocumentSelectionReply } from './documentSelection.ts';

const LISTING = [
  { name: 'Accessibility Standard.md', folderPath: '/Standards', modifiedAtIso: '2026-08-01T00:00:00Z' },
  { name: 'Q1 Retro.txt', folderPath: '/Notes', modifiedAtIso: '2026-07-01T00:00:00Z' },
  { name: 'Enrollment Design.html', folderPath: '/Design', modifiedAtIso: '2026-08-15T00:00:00Z' },
];

describe('buildDocumentSelectionPrompt', () => {
  it('lists every document name so the choice is made from the real library', () => {
    const prompt = buildDocumentSelectionPrompt(LISTING, 'Re-writing the enrolment Features');

    expect(prompt).toContain('Accessibility Standard.md');
    expect(prompt).toContain('Q1 Retro.txt');
    expect(prompt).toContain('Enrollment Design.html');
  });

  it('says where each document sits, because two folders can hold the same name', () => {
    expect(buildDocumentSelectionPrompt(LISTING, 'task')).toContain('/Standards');
  });

  it('gives the date, so a stale document can be passed over', () => {
    expect(buildDocumentSelectionPrompt(LISTING, 'task')).toContain('2026-08-01');
  });

  it('states the task, so relevance is judged against something', () => {
    expect(buildDocumentSelectionPrompt(LISTING, 'Re-writing the enrolment Features'))
      .toContain('Re-writing the enrolment Features');
  });

  it('forbids inventing a name, which is the failure that would waste the whole round trip', () => {
    const prompt = buildDocumentSelectionPrompt(LISTING, 'task');
    expect(prompt).toMatch(/only.*listed above|exactly as listed/i);
  });

  it('asks for nothing at all when the folder held no readable documents', () => {
    expect(buildDocumentSelectionPrompt([], 'task')).toBe('');
  });
});

describe('parseDocumentSelectionReply', () => {
  const knownNames = LISTING.map((document) => document.name);

  it('returns the documents the assistant asked for', () => {
    const reply = '{"kind":"documentSelection","documents":["Accessibility Standard.md"]}';
    const result = parseDocumentSelectionReply(reply, knownNames);

    expect(result.selectedNames).toEqual(['Accessibility Standard.md']);
    expect(result.rejectedNames).toEqual([]);
  });

  it('refuses a name the library does not hold, and names it', () => {
    // The anti-hallucination rule this app applies everywhere: a value that must match an external
    // system exactly is checked against that system, never trusted.
    const reply = '{"kind":"documentSelection","documents":["Accessibility Standard.md","Invented Policy.md"]}';
    const result = parseDocumentSelectionReply(reply, knownNames);

    expect(result.selectedNames).toEqual(['Accessibility Standard.md']);
    expect(result.rejectedNames).toEqual(['Invented Policy.md']);
  });

  it('reads a reply wrapped in prose or a code fence, as assistants send them', () => {
    const reply = 'Sure!\n```json\n{"kind":"documentSelection","documents":["Q1 Retro.txt"]}\n```';
    expect(parseDocumentSelectionReply(reply, knownNames).selectedNames).toEqual(['Q1 Retro.txt']);
  });

  it('refuses a reply of the wrong kind rather than guessing what it meant', () => {
    expect(() => parseDocumentSelectionReply('{"kind":"somethingElse","documents":[]}', knownNames))
      .toThrow(/documentSelection/);
  });

  it('treats an empty selection as a real answer, not a failure', () => {
    // "None of these are relevant" is a useful reply, and forcing a choice would be worse than none.
    const result = parseDocumentSelectionReply('{"kind":"documentSelection","documents":[]}', knownNames);
    expect(result.selectedNames).toEqual([]);
    expect(result.rejectedNames).toEqual([]);
  });

  it('de-duplicates a name the assistant asked for twice', () => {
    const reply = '{"kind":"documentSelection","documents":["Q1 Retro.txt","Q1 Retro.txt"]}';
    expect(parseDocumentSelectionReply(reply, knownNames).selectedNames).toEqual(['Q1 Retro.txt']);
  });

  it('ignores an entry that is not a string rather than throwing on the whole reply', () => {
    const reply = '{"kind":"documentSelection","documents":["Q1 Retro.txt",42,null]}';
    expect(parseDocumentSelectionReply(reply, knownNames).selectedNames).toEqual(['Q1 Retro.txt']);
  });

  it('says plainly when the reply is not JSON at all', () => {
    expect(() => parseDocumentSelectionReply('I could not decide.', knownNames)).toThrow();
  });
});
