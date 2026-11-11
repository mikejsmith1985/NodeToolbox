// splitAiAssist.test.ts — Proves the split ingest is strict about identity and lenient about content,
// that proposals land unaccepted, and that nothing an assistant says reaches Jira (INV-3, SC-009,
// FR-018, FR-020).

import { describe, expect, it } from 'vitest';

import { SPLIT_HEURISTICS } from '../coaching/splitHeuristics';
import type { SourceFeatureSnapshot } from '../drafts/draftModel';
import { buildSplitFollowUp, buildSplitPrompt, MAX_SPLIT_TABLE_ROWS, parseSplitIngest } from './splitAiAssist';

const SOURCE: SourceFeatureSnapshot = {
  key: 'ABC-1',
  projectKey: 'ABC',
  issueTypeId: '10001',
  issueTypeName: 'Feature',
  summary: 'Claims platform',
  description: 'Everything about claims.',
  acceptanceCriteria: 'Given a claim…',
  fields: {},
  loadedAtIso: '2026-07-15T09:00:00.000Z',
};

/** A well-formed reply. */
function buildReply(increments: unknown[]): string {
  return JSON.stringify({ kind: 'featureSplitIngest', increments });
}

describe('buildSplitPrompt', () => {
  it('gives the assistant the Feature it must split', () => {
    const prompt = buildSplitPrompt(SOURCE, SPLIT_HEURISTICS);

    expect(prompt).toContain('ABC-1');
    expect(prompt).toContain('Claims platform');
    expect(prompt).toContain('Everything about claims.');
    expect(prompt).toContain('Given a claim…');
  });

  it('teaches the assistant the same heuristics the tab teaches the PO', () => {
    // If the AI split along different lines from the coaching, the two halves would contradict.
    const prompt = buildSplitPrompt(SOURCE, SPLIT_HEURISTICS);

    expect(prompt).toContain('Happy path first');
    expect(prompt).toContain('By workflow step');
  });

  it('states the bar an increment must clear', () => {
    const prompt = buildSplitPrompt(SOURCE, SPLIT_HEURISTICS);

    expect(prompt).toMatch(/releasable without waiting/i);
    expect(prompt).toMatch(/inside one Program Increment/i);
  });

  it('forbids the assistant from choosing structure — that is the PO\'s call (FR-037)', () => {
    const prompt = buildSplitPrompt(SOURCE, SPLIT_HEURISTICS);

    expect(prompt).toMatch(/Do not propose issue types, projects, or/i);
  });

  it('ends with a fill-in table of numbered rows instead of a JSON schema (GH #499)', () => {
    const prompt = buildSplitPrompt(SOURCE, SPLIT_HEURISTICS);

    expect(prompt).toContain('SPLIT_TABLE:');
    expect(prompt).toContain('Increment | Summary | Description | Acceptance criteria | Rationale');
    expect(prompt).toContain('1 | ___ | ___ | ___ | ___');
    expect(prompt).toContain(`${MAX_SPLIT_TABLE_ROWS} | ___ | ___ | ___ | ___`);
    expect(prompt).not.toContain('Respond ONLY with valid JSON:');
  });

  it('carries NO credential of any kind (Article IX, INV-J7)', () => {
    const prompt = buildSplitPrompt(SOURCE, SPLIT_HEURISTICS);

    expect(prompt).not.toMatch(/password|token|bearer|api[_-]?key|secret/i);
  });
});

describe('parseSplitIngest — strict about identity (SC-009)', () => {
  it('rejects the WHOLE payload when the kind is wrong', () => {
    // The guard that stops a reply meant for another surface being read as a split.
    const result = parseSplitIngest(
      JSON.stringify({ kind: 'sizeEstimate', increments: [{ summary: 'Looks real' }] }),
      [],
    );

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain('is not featureSplitIngest');
  });

  it('rejects a reply with no kind at all', () => {
    const result = parseSplitIngest(JSON.stringify({ increments: [{ summary: 'X' }] }), []);

    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('reports unreadable text rather than throwing', () => {
    const result = parseSplitIngest('I am afraid I cannot help with that.', []);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toBe('No JSON object found in the assistant response.');
  });

  it('reports malformed JSON rather than throwing', () => {
    const result = parseSplitIngest('{ "kind": "featureSplitIngest", oops }', []);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toBe('The assistant response was not valid JSON.');
  });

  it('reports a missing increments array', () => {
    const result = parseSplitIngest(JSON.stringify({ kind: 'featureSplitIngest' }), []);

    expect(result.errors[0]).toMatch(/"increments" field is missing/);
  });
});

describe('parseSplitIngest — lenient about content (INV-3)', () => {
  it('reads a well-formed proposal', () => {
    const result = parseSplitIngest(
      buildReply([{
        summary: 'Submit a claim with one document',
        description: 'The happy path.',
        acceptanceCriteria: 'Given a valid claim…',
        rationale: 'Happy path first.',
      }]),
      [],
    );

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].summary).toBe('Submit a claim with one document');
    expect(result.items[0].rationale).toBe('Happy path first.');
  });

  it('keeps the GOOD increments when one is bad — a PO must not lose four to a fifth', () => {
    const result = parseSplitIngest(
      buildReply([
        { summary: 'Good one' },
        { description: 'no summary here' },
        { summary: 'Another good one' },
      ]),
      [],
    );

    expect(result.items.map((item) => item.summary)).toEqual(['Good one', 'Another good one']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('position 2');
  });

  it('says which position was skipped, so the PO can look for what is missing', () => {
    const result = parseSplitIngest(buildReply([{ summary: 'Fine' }, null]), []);

    expect(result.errors[0]).toContain('position 2');
  });

  it('tolerates a non-string field rather than failing the item', () => {
    const result = parseSplitIngest(buildReply([{ summary: 'Fine', description: 42 }]), []);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe('');
  });
});

describe('parseSplitIngest — tolerates how assistants actually reply (FR-018)', () => {
  it('reads JSON wrapped in a code fence', () => {
    const result = parseSplitIngest(
      '```json\n' + buildReply([{ summary: 'Fenced' }]) + '\n```',
      [],
    );

    expect(result.items).toHaveLength(1);
  });

  it('reads JSON surrounded by chatter', () => {
    const result = parseSplitIngest(
      `Sure! Here is my proposal:\n\n${buildReply([{ summary: 'Chatty' }])}\n\nHope that helps!`,
      [],
    );

    expect(result.items).toHaveLength(1);
  });
});

describe('parseSplitIngest — the PO decides (FR-020)', () => {
  it('lands every proposal UNACCEPTED', () => {
    const result = parseSplitIngest(buildReply([{ summary: 'One' }, { summary: 'Two' }]), []);

    expect(result.items.every((item) => item.isAccepted === false)).toBe(true);
  });

  it('marks proposals as AI-authored, so the PO can see what came from where', () => {
    const result = parseSplitIngest(buildReply([{ summary: 'One' }]), []);

    expect(result.items[0].origin).toBe('ai');
  });

  it('gives every proposal an id that cannot collide with the PO\'s own increments', () => {
    const existing = [
      { ...parseSplitIngest(buildReply([{ summary: 'x' }]), []).items[0], localId: 'increment-1' },
    ];

    const result = parseSplitIngest(buildReply([{ summary: 'One' }, { summary: 'Two' }]), existing);

    const ids = result.items.map((item) => item.localId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('increment-1');
  });

  it('never carries a Jira key — nothing it proposes exists yet', () => {
    const result = parseSplitIngest(buildReply([{ summary: 'One' }]), []);

    expect(result.items[0].createdJiraKey).toBeNull();
  });
});

// An AI Mode reply: an intro sentence, the table as markdown with unused rows left blank, and a closing offer.
const AI_MODE_SPLIT_REPLY = [
  'Here is a proposed split of ABC-1 into smaller Features:',
  '',
  'SPLIT_TABLE:',
  '| Increment | Summary | Description | Acceptance criteria | Rationale |',
  '|---|---|---|---|---|',
  '| 1 | Submit a claim online | Claimants file a claim without paper. | Claim saved; reference shown | Happy path first |',
  '| 2 | Attach documents | Claimants add files to a claim. | PDF accepted; 10 MB limit | By workflow step |',
  '| 3 | ___ | ___ | ___ | ___ |',
  '',
  'If you would like, I can also estimate each increment.',
].join('\n');

// The same table pasted from the web page: tab-separated cells.
const TAB_SPLIT_REPLY = [
  'Increment\tSummary\tDescription\tAcceptance criteria\tRationale',
  '1\tSubmit a claim online\tClaimants file a claim without paper.\tClaim saved\tHappy path first',
  '2\tAttach documents\tClaimants add files.\tPDF accepted\tBy workflow step',
].join('\n');

describe('parseSplitIngest — Google AI Mode replies (GH #499)', () => {
  it('reads a markdown table with an intro and a closing offer, ignoring the unused rows', () => {
    const result = parseSplitIngest(AI_MODE_SPLIT_REPLY, []);

    expect(result.errors).toEqual([]);
    expect(result.items.map((item) => item.summary)).toEqual(['Submit a claim online', 'Attach documents']);
    expect(result.items[1].acceptanceCriteria).toBe('PDF accepted; 10 MB limit');
    expect(result.items[0].rationale).toBe('Happy path first');
    expect(result.items.every((item) => item.isAccepted === false && item.origin === 'ai')).toBe(true);
  });

  it('reads a tab-separated table pasted from the web page the same way', () => {
    const result = parseSplitIngest(TAB_SPLIT_REPLY, []);

    expect(result.items.map((item) => item.summary)).toEqual(['Submit a claim online', 'Attach documents']);
  });
});

describe('buildSplitFollowUp', () => {
  it('offers nothing when every filled row named its increment', () => {
    expect(buildSplitFollowUp(AI_MODE_SPLIT_REPLY)).toBe('');
  });

  it('asks for the table again when the reply could not be read', () => {
    const followUp = buildSplitFollowUp('You could split this by user role and by workflow step.');

    expect(followUp).toMatch(/not in the form I need/);
    expect(followUp).toContain('1 | ___ | ___ | ___ | ___');
  });

  it('asks for the table again when every row came back blank', () => {
    expect(buildSplitFollowUp(AI_MODE_SPLIT_REPLY.replace(/\| [12] \| [^\n]*\n/g, ''))).toMatch(/not in the form I need/);
  });

  it('asks only for the rows that described an increment without naming it — never inventing a name', () => {
    const partialReply = AI_MODE_SPLIT_REPLY.replace('| 2 | Attach documents |', '| 2 | ___ |');

    const followUp = buildSplitFollowUp(partialReply);

    expect(followUp).toMatch(/no summary for increment 2/);
    expect(followUp).toContain('2 | ___ | ___ | ___ | ___');
    expect(followUp).not.toContain('1 | ___');
    expect(parseSplitIngest(partialReply, []).errors[0]).toMatch(/missing a summary/);
  });
});
