// compositionAiAssist.test.ts — Proves the composition prompt leads with the PO's own words, and that an
// assistant cannot steer a write at a field nobody offered it (FR-031, FR-033, FR-037, SC-009).

import { describe, expect, it } from 'vitest';

import { DEFINITION_OF_READY } from '../coaching/definitionOfReady';
import { createEmptyCompositionDraft, type CompositionDraft } from '../drafts/draftModel';
import { buildCompositionPrompt, parseCompositionIngest } from './compositionAiAssist';

const WRITABLE_FIELDS = {
  customfield_10200: 'Acceptance Criteria',
  customfield_10101: 'Target Start',
};

function buildDraft(overrides: Partial<CompositionDraft> = {}): CompositionDraft {
  return {
    ...createEmptyCompositionDraft('profile-alpha', 'new:1'),
    poNarrative: 'Claimants keep emailing documents in and we lose them.',
    summary: 'Claimant document submission',
    sources: [
      {
        kind: 'confluence',
        id: 'confluence-1',
        title: 'Claims brief',
        pageUrl: 'https://wiki/pages/12345/Claims',
        pageId: '12345',
        text: 'Claimants cannot attach documents today.',
        fetchedAtIso: '2026-07-15T09:00:00.000Z',
      },
      { kind: 'paste', id: 'paste-1', label: 'Teams thread', text: 'Jana confirmed the SLA is 48 hours.' },
    ],
    ...overrides,
  };
}

/** A well-formed reply. */
function buildReply(feature: unknown): string {
  return JSON.stringify({ kind: 'featureCompositionIngest', feature });
}

describe('buildCompositionPrompt — the PO\'s intent leads (FR-031)', () => {
  it('puts the PO\'s own words at the top', () => {
    // An assistant handed only documents writes a summary of the documents. The intent is what the PO said.
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toContain('Claimants keep emailing documents in and we lose them.');
    expect(prompt.indexOf('Claimants keep emailing')).toBeLessThan(prompt.indexOf('Claims brief'));
  });

  it('says plainly when the PO has not written their description yet', () => {
    const prompt = buildCompositionPrompt(buildDraft({ poNarrative: '' }), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toMatch(/they have not written this yet/i);
  });

  it('hands over every gathered source, with its origin', () => {
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toContain('Claimants cannot attach documents today.');
    expect(prompt).toContain('Jana confirmed the SLA is 48 hours.');
    expect(prompt).toContain('https://wiki/pages/12345/Claims');
  });

  it('copes with a composition that has no material yet', () => {
    const prompt = buildCompositionPrompt(buildDraft({ sources: [] }), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toMatch(/not gathered any supporting material/i);
  });

  it('truncates a very long source and says so, rather than crowding out the rest', () => {
    const hugeDraft = buildDraft({
      sources: [{ kind: 'paste', id: 'paste-1', label: 'Huge', text: 'x'.repeat(9000) }],
    });

    const prompt = buildCompositionPrompt(hugeDraft, DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toContain('(truncated');
    expect(prompt.length).toBeLessThan(9000);
  });
});

describe('buildCompositionPrompt — the readiness bar (FR-033)', () => {
  it('tells the assistant what "ready" means, so an accepted draft starts close to complete', () => {
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toContain('The problem is stated, not the solution');
    expect(prompt).toContain('Acceptance criteria are testable');
  });

  it('whitelists the writable fields by exact id, and forbids inventing others (FR-037)', () => {
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toContain('"customfield_10200" (Acceptance Criteria)');
    expect(prompt).toMatch(/Do not invent field ids/i);
  });

  it('says plainly when there are no writable fields, rather than showing an empty list', () => {
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, {});

    expect(prompt).toMatch(/do not include a "fields" object/i);
  });

  it('forbids the assistant from choosing project or issue type', () => {
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).toMatch(/Do not choose the/i);
  });

  it('carries NO credential (Article IX, INV-J7)', () => {
    const prompt = buildCompositionPrompt(buildDraft(), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt).not.toMatch(/password|token|bearer|api[_-]?key|secret/i);
  });
});

describe('parseCompositionIngest — strict about identity (SC-009)', () => {
  it('rejects the whole payload when the kind is wrong', () => {
    const result = parseCompositionIngest(
      JSON.stringify({ kind: 'featureSplitIngest', feature: { summary: 'Looks real' } }),
      Object.keys(WRITABLE_FIELDS),
    );

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain('is not featureCompositionIngest');
  });

  it('reports unreadable text rather than throwing', () => {
    const result = parseCompositionIngest('no json here', Object.keys(WRITABLE_FIELDS));

    expect(result.errors[0]).toBe('No JSON object found in the assistant response.');
  });

  it('reports a missing feature object', () => {
    const result = parseCompositionIngest(
      JSON.stringify({ kind: 'featureCompositionIngest' }),
      Object.keys(WRITABLE_FIELDS),
    );

    expect(result.errors[0]).toMatch(/"feature" field is missing/);
  });

  it('refuses a proposal with no summary — that is the issue\'s name', () => {
    const result = parseCompositionIngest(buildReply({ description: 'Lots of words' }), []);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toMatch(/missing a summary/i);
  });
});

describe('parseCompositionIngest — an assistant cannot invent fields (FR-037)', () => {
  it('reads a well-formed proposal', () => {
    const result = parseCompositionIngest(
      buildReply({
        summary: 'Claimant document submission',
        description: 'Claimants cannot attach documents.',
        acceptanceCriteria: 'Given a claim in draft…',
        fields: { customfield_10101: '2026-08-01' },
        rationale: 'Framed against the DoR.',
      }),
      Object.keys(WRITABLE_FIELDS),
    );

    expect(result.errors).toEqual([]);
    expect(result.items[0].summary).toBe('Claimant document submission');
    expect(result.items[0].fields).toEqual({ customfield_10101: '2026-08-01' });
  });

  it('DROPS a field the prompt never offered, and says it did', () => {
    // An assistant must not be able to steer a write at a field nobody gave it.
    const result = parseCompositionIngest(
      buildReply({ summary: 'A Feature', fields: { customfield_99999: 'invented' } }),
      Object.keys(WRITABLE_FIELDS),
    );

    expect(result.items[0].fields).toEqual({});
    expect(result.errors[0]).toContain('customfield_99999');
    expect(result.errors[0]).toMatch(/ignored/i);
  });

  it('keeps the allowed fields while dropping the invented one', () => {
    const result = parseCompositionIngest(
      buildReply({
        summary: 'A Feature',
        fields: { customfield_10101: '2026-08-01', customfield_99999: 'invented' },
      }),
      Object.keys(WRITABLE_FIELDS),
    );

    expect(result.items[0].fields).toEqual({ customfield_10101: '2026-08-01' });
    expect(result.errors).toHaveLength(1);
  });

  it('copes with a proposal that sets no fields at all', () => {
    const result = parseCompositionIngest(buildReply({ summary: 'A Feature' }), Object.keys(WRITABLE_FIELDS));

    expect(result.items[0].fields).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it('drops everything when no field is writable', () => {
    const result = parseCompositionIngest(
      buildReply({ summary: 'A Feature', fields: { customfield_10101: 'x' } }),
      [],
    );

    expect(result.items[0].fields).toEqual({});
    expect(result.errors).toHaveLength(1);
  });
});

describe('parseCompositionIngest — tolerates how assistants actually reply', () => {
  it('reads JSON wrapped in a fence and prose', () => {
    const result = parseCompositionIngest(
      'Certainly:\n```json\n' + buildReply({ summary: 'Fenced' }) + '\n```\nLet me know!',
      Object.keys(WRITABLE_FIELDS),
    );

    expect(result.items[0].summary).toBe('Fenced');
  });
});
