// jiraMentionFormat.test.ts — Unit tests for the shared mention vocabulary (parse + build).
//
// This is the module where reading a mention and writing one are guaranteed to agree (NFR-002),
// so the round-trip test below is the load-bearing one: if it passes, the two directions cannot
// drift apart.

import { describe, expect, it } from 'vitest';

import type { FeatureReviewUserCandidate } from '../views/SprintDashboard/featureReviewFixes.ts';
import {
  buildMentionToken,
  extractMentionTokens,
  formatMentionForDisplay,
  parseCommentMentions,
  readMentionDirectoryKey,
  type MentionRun,
} from './jiraMentionFormat.ts';

// ── Helpers ──

/** Rebuilds the original body text from a run list, to assert nothing was invented or lost (P1). */
function joinRunSourceText(runs: MentionRun[]): string {
  return runs.map((run) => (run.kind === 'text' ? run.text : run.token.raw)).join('');
}

/** Returns only the mention runs, for concise assertions about who was named. */
function mentionIdentifiers(runs: MentionRun[]): string[] {
  return runs.filter((run) => run.kind === 'mention').map((run) => run.token.identifier);
}

const CLOUD_CANDIDATE: FeatureReviewUserCandidate = {
  userIdentifier: 'accountId:557058:ab-12',
  displayName: 'Jane Doe',
};
const SERVER_NAME_CANDIDATE: FeatureReviewUserCandidate = {
  userIdentifier: 'name:jsmith',
  displayName: 'Jane Smith',
};
const SERVER_KEY_CANDIDATE: FeatureReviewUserCandidate = {
  userIdentifier: 'key:JIRAUSER123',
  displayName: 'Bob Key',
};

// ── The NFR-002 invariant ──

describe('round-trip: build → parse (the agree-by-construction invariant)', () => {
  it.each([
    ['Cloud accountId', CLOUD_CANDIDATE, '557058:ab-12'],
    ['Data Center username', SERVER_NAME_CANDIDATE, 'jsmith'],
    ['Data Center user key', SERVER_KEY_CANDIDATE, 'JIRAUSER123'],
  ])('parses back the identifier it built for %s', (_label, candidate, expectedIdentifier) => {
    const token = buildMentionToken(candidate);
    expect(token).not.toBeNull();

    const runs = parseCommentMentions(token!.raw);

    // Exactly one mention, carrying the identifier we started from. Flavour is deliberately NOT
    // asserted: a bare "[~X]" body cannot reveal whether X was a username or a user key, so a
    // key-flavoured person round-trips as name-flavoured. The identifier is what addresses them.
    expect(runs).toHaveLength(1);
    expect(mentionIdentifiers(runs)).toEqual([expectedIdentifier]);
  });
});

// ── Parsing wiki-markup bodies ──

describe('parseCommentMentions — wiki markup', () => {
  it('splits a Cloud mention mid-sentence into text, mention, text', () => {
    const runs = parseCommentMentions('Hey [~accountid:557058:ab-12] please review');

    expect(runs.map((run) => run.kind)).toEqual(['text', 'mention', 'text']);
    expect(mentionIdentifiers(runs)).toEqual(['557058:ab-12']);
    expect(joinRunSourceText(runs)).toBe('Hey [~accountid:557058:ab-12] please review');
  });

  it('recognises a Data Center mention', () => {
    const runs = parseCommentMentions('ping [~jsmith]');

    expect(mentionIdentifiers(runs)).toEqual(['jsmith']);
  });

  it('returns the correct identifier for each of several different people, in order', () => {
    const runs = parseCommentMentions('[~jsmith] and [~accountid:557058:ab-12] and [~bwilson] please');

    expect(mentionIdentifiers(runs)).toEqual(['jsmith', '557058:ab-12', 'bwilson']);
  });

  it('produces no empty text run between adjacent mentions', () => {
    const runs = parseCommentMentions('[~jsmith][~bwilson]');

    expect(runs.map((run) => run.kind)).toEqual(['mention', 'mention']);
  });

  it('yields exactly one text run for a body with no mentions', () => {
    const runs = parseCommentMentions('Just a plain comment.');

    expect(runs).toEqual([{ kind: 'text', text: 'Just a plain comment.' }]);
  });

  it('leaves an email address untouched as plain text', () => {
    const runs = parseCommentMentions('mail me at mike@example.com please');

    expect(runs).toEqual([{ kind: 'text', text: 'mail me at mike@example.com please' }]);
  });

  it.each([
    ['empty token', 'before [~] after'],
    ['accountid with no value', 'before [~accountid:] after'],
    ['unclosed token', 'before [~foo after'],
  ])('keeps a malformed mention (%s) as verbatim text, never a broken mention', (_label, body) => {
    const runs = parseCommentMentions(body);

    expect(runs.every((run) => run.kind === 'text')).toBe(true);
    expect(joinRunSourceText(runs)).toBe(body);
  });

  it('returns an empty list for null, undefined, and non-body values', () => {
    expect(parseCommentMentions(null)).toEqual([]);
    expect(parseCommentMentions(undefined)).toEqual([]);
    expect(parseCommentMentions(42)).toEqual([]);
  });
});

// ── Parsing ADF bodies (the FR-002 data-loss defect) ──

describe('parseCommentMentions — Atlassian Document Format', () => {
  it('does NOT drop a mention node sitting between two text nodes', () => {
    const adfBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hey ' },
            { type: 'mention', attrs: { id: '557058:ab-12', text: '@Jane Doe' } },
            { type: 'text', text: ' please review' },
          ],
        },
      ],
    };

    const runs = parseCommentMentions(adfBody);

    // Today the shared plain-text normalizer yields "Hey  please review" — the person vanishes.
    expect(mentionIdentifiers(runs)).toEqual(['557058:ab-12']);
    expect(runs.filter((run) => run.kind === 'text').map((run) => run.kind === 'text' && run.text))
      .toEqual(['Hey ', ' please review']);
  });

  it('finds a mention nested several levels deep', () => {
    const adfBody = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'abc' } }] }] },
      ],
    };

    expect(mentionIdentifiers(parseCommentMentions(adfBody))).toEqual(['abc']);
  });

  it('still yields a mention when the node carries an id but no display text', () => {
    const adfBody = { type: 'doc', content: [{ type: 'mention', attrs: { id: '557058:ab-12' } }] };

    expect(mentionIdentifiers(parseCommentMentions(adfBody))).toEqual(['557058:ab-12']);
  });

  it('ignores a mention node with no usable id', () => {
    const adfBody = { type: 'doc', content: [{ type: 'mention', attrs: { text: '@Nobody' } }] };

    expect(mentionIdentifiers(parseCommentMentions(adfBody))).toEqual([]);
  });
});

// ── Building a token from a picked person ──

describe('buildMentionToken', () => {
  it.each([
    ['Cloud accountId', CLOUD_CANDIDATE, '[~accountid:557058:ab-12]'],
    ['Data Center username', SERVER_NAME_CANDIDATE, '[~jsmith]'],
    ['Data Center user key', SERVER_KEY_CANDIDATE, '[~JIRAUSER123]'],
  ])('builds the %s form', (_label, candidate, expectedRaw) => {
    expect(buildMentionToken(candidate)?.raw).toBe(expectedRaw);
  });

  it.each([
    ['unrecognised prefix', 'email:mike@example.com'],
    ['no prefix at all', 'jsmith'],
    ['empty value after prefix', 'accountId:'],
    ['empty string', ''],
  ])('returns null for %s, so an un-taggable person is never offered', (_label, userIdentifier) => {
    expect(buildMentionToken({ userIdentifier, displayName: 'Someone' })).toBeNull();
  });
});

// ── Store keying ──

describe('readMentionDirectoryKey', () => {
  it('returns the prefixed identifier so two flavours can never collide', () => {
    const token = buildMentionToken(CLOUD_CANDIDATE);

    expect(readMentionDirectoryKey(token!)).toBe('accountId:557058:ab-12');
  });
});

// ── Extracting mentions from a composer draft ──

describe('extractMentionTokens', () => {
  it('returns every mention in a draft, in order', () => {
    const tokens = extractMentionTokens('Thanks [~jsmith] and [~accountid:557058:ab-12] for the help');

    expect(tokens.map((token) => token.identifier)).toEqual(['jsmith', '557058:ab-12']);
  });

  it('returns an empty list for a draft with no mentions', () => {
    expect(extractMentionTokens('no one tagged here')).toEqual([]);
  });
});

// ── Display formatting ──

describe('formatMentionForDisplay', () => {
  const token = buildMentionToken(CLOUD_CANDIDATE)!;

  it('shows the display name once resolved', () => {
    expect(formatMentionForDisplay(token, { status: 'resolved', displayName: 'Jane Doe' })).toBe('@Jane Doe');
  });

  it('shows the neutral placeholder when the person cannot be identified', () => {
    expect(formatMentionForDisplay(token, { status: 'unresolvable' })).toBe('@unknown user');
  });

  it('does NOT reuse the unresolvable placeholder while a lookup is still pending', () => {
    // FR-005a: "still loading" and "cannot be identified" are different facts and must never
    // render the same. This test fails if someone collapses the two states.
    const pendingText = formatMentionForDisplay(token, { status: 'pending' });

    expect(pendingText).not.toBe('@unknown user');
  });
});
