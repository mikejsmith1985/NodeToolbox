// githubRulePrompt.test.ts — The AI-assist rule prompt and reply parser, plus the custom-rule compile path.

import { describe, expect, it } from 'vitest';

import { parseGithubEmail } from './classifyGithubEmail.ts';
import { compileCustomRules, validateSerializedRule, type SerializedEmailRule } from './githubEmailRules.ts';
import {
  buildRulePrompt,
  parseRuleReply,
  buildBulkRulePrompt,
  emailSampleSignature,
  parseRuleReplyToList,
  type EmailSample,
} from './githubRulePrompt.ts';

function email(headers: Record<string, string>, body: string): string {
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  return [...headerLines, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
}

describe('buildRulePrompt', () => {
  it('names every classifiable event type and the JSON shape', () => {
    const prompt = buildRulePrompt();
    expect(prompt).toContain('pr_merged');
    expect(prompt).toContain('branch_created');
    expect(prompt).toContain('"kind": "githubEmailRule"');
    expect(prompt).toContain('subjectPattern');
    expect(prompt).toMatch(/PASTE THE FULL RAW GITHUB NOTIFICATION EMAIL/);
  });
});

describe('parseRuleReply', () => {
  it('reads an enveloped rule wrapped in prose and code fences', () => {
    const reply = 'Sure! Here is the rule:\n```json\n{"kind":"githubEmailRule","rule":{"id":"pr-ready","eventType":"pr_merged","bodyPattern":"deployed to prod","requiresPrNumber":true}}\n```';
    const result = parseRuleReply(reply);
    expect(result.ok).toBe(true);
    expect(result.rule).toEqual({ id: 'pr-ready', eventType: 'pr_merged', bodyPattern: 'deployed to prod', requiresPrNumber: true });
  });

  it('accepts a bare rule object (no envelope)', () => {
    const result = parseRuleReply('{"id":"x","eventType":"pr_opened","reasonHeaderIn":["review_requested"]}');
    expect(result.ok).toBe(true);
    expect(result.rule?.eventType).toBe('pr_opened');
  });

  it('rejects a reply from a different AI surface via the kind guard', () => {
    const result = parseRuleReply('{"kind":"piReview","items":[]}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a GitHub email rule/);
  });

  it('rejects the reserved "unknown" event type but accepts a new custom slug', () => {
    // A new snake_case bucket is now allowed (the AI may coin one); only the reserved catch-all is refused.
    expect(parseRuleReply('{"id":"x","eventType":"unknown","bodyPattern":"a"}').ok).toBe(false);
    expect(parseRuleReply('{"id":"x","eventType":"pr_approved","bodyPattern":"a"}').ok).toBe(true);
  });

  it('rejects an invalid regex pattern', () => {
    const result = parseRuleReply('{"id":"x","eventType":"pr_merged","bodyPattern":"([unclosed"}');
    expect(result.ok).toBe(false);
  });

  it('rejects a rule with no matchers (would match every email)', () => {
    const result = parseRuleReply('{"id":"x","eventType":"pr_merged"}');
    expect(result.ok).toBe(false);
  });

  it('rejects non-JSON', () => {
    expect(parseRuleReply('no json here').ok).toBe(false);
  });
});

describe('validateSerializedRule + compileCustomRules', () => {
  it('drops invalid rules and keeps valid ones', () => {
    const compiled = compileCustomRules([
      { id: 'good', eventType: 'pr_opened', reasonHeaderIn: ['subscribed'] },
      { id: '', eventType: 'pr_opened', reasonHeaderIn: ['x'] },   // no id
      { id: 'bad', eventType: 'unknown', bodyPattern: 'x' },       // reserved event type
      { id: 'sym', eventType: 'drop; tables', bodyPattern: 'x' },  // unsafe slug
      'not an object',
    ]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].id).toBe('good');
  });

  it('normalizes and strips blank optional fields', () => {
    const rule = validateSerializedRule({ id: ' r ', eventType: 'commit_pushed', reasonHeaderIn: ['push', ''], subjectPattern: '' });
    expect(rule).toEqual({ id: 'r', eventType: 'commit_pushed', reasonHeaderIn: ['push'] });
  });
});

describe('custom rules applied end to end (win over the built-ins)', () => {
  it('classifies a PR-opened email via a user rule the built-in table would miss', () => {
    // GitHub's real "opened" reason varies; suppose this org's opened emails only carry reason "subscribed"
    // with a distinctive body line. The built-in table would call this unknown; a custom rule fixes it.
    const raw = email(
      { 'List-ID': 'org/repo <repo.org.github.com>', 'Subject': '[org/repo] [KEY-9] New work (#42)', 'X-GitHub-Reason': 'subscribed', 'Message-ID': '<a@github.com>' },
      'octocat wants to merge 3 commits',
    );

    expect(parseGithubEmail(raw).eventType).toBe('unknown');

    const customRules: SerializedEmailRule[] = [{ id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true }];
    const event = parseGithubEmail(raw, customRules);
    expect(event.eventType).toBe('pr_opened');
    expect(event.matchedRuleId).toBe('org-pr-opened');
    expect(event.jiraKey).toBe('KEY-9');
  });
});

describe('custom event-type buckets (new buckets from the AI intake)', () => {
  it('accepts a NEW snake_case bucket the built-in set does not list', () => {
    const rule = validateSerializedRule({ id: 'pr-approved', eventType: 'pr_approved', bodyPattern: 'approved this pull request' });
    expect(rule).not.toBeNull();
    expect(rule?.eventType).toBe('pr_approved');
  });

  it('still rejects the reserved "unknown" and unsafe event-type slugs', () => {
    expect(validateSerializedRule({ id: 'x', eventType: 'unknown', bodyPattern: 'a' })).toBeNull();
    expect(validateSerializedRule({ id: 'x', eventType: 'pr approved', bodyPattern: 'a' })).toBeNull();  // space
    expect(validateSerializedRule({ id: 'x', eventType: 'drop; tables', bodyPattern: 'a' })).toBeNull(); // symbols
  });

  it('classifies an email into a custom bucket via an AI-authored rule', () => {
    const raw = email(
      { 'List-ID': 'org/repo <repo.org.github.com>', 'Subject': '[org/repo] [KEY-9] Thing (#42)', 'X-GitHub-Reason': 'subscribed', 'Message-ID': '<c@github.com>' },
      'octocat approved this pull request.',
    );
    const customRules: SerializedEmailRule[] = [{ id: 'pr-approved', eventType: 'pr_approved', bodyPattern: 'approved this pull request', requiresPrNumber: true }];
    const event = parseGithubEmail(raw, customRules);
    expect(event.eventType).toBe('pr_approved');
    expect(event.matchedRuleId).toBe('pr-approved');
    expect(event.jiraKey).toBe('KEY-9');
  });
});

describe('operator rule fields (enable/disable, comment, transition)', () => {
  it('validateSerializedRule preserves isEnabled=false, comment, and transitionStatus', () => {
    const rule = validateSerializedRule({
      id: 'r', eventType: 'pr_approved', bodyPattern: 'approved',
      isEnabled: false, comment: 'Approved by a reviewer.', transitionStatus: 'In Review',
    });
    expect(rule).toMatchObject({ isEnabled: false, comment: 'Approved by a reviewer.', transitionStatus: 'In Review' });
  });

  it('validateSerializedRule leaves an enabled rule clean (no isEnabled flag) and drops blank action fields', () => {
    const rule = validateSerializedRule({ id: 'r', eventType: 'pr_opened', bodyPattern: 'opened', isEnabled: true, comment: '  ', transitionStatus: '' });
    expect(rule).toEqual({ id: 'r', eventType: 'pr_opened', bodyPattern: 'opened' });
  });

  it('compileCustomRules skips a disabled rule so it never classifies', () => {
    const compiled = compileCustomRules([
      { id: 'on', eventType: 'pr_opened', bodyPattern: 'opened' },
      { id: 'off', eventType: 'pr_merged', bodyPattern: 'merged into', isEnabled: false },
    ]);
    expect(compiled.map((rule) => rule.id)).toEqual(['on']);
  });
});

// ── Bulk rule generation ──

function sample(fileName: string, headers: Record<string, string>, body: string): EmailSample {
  return { fileName, eventType: 'unknown', rawSource: email(headers, body) };
}

describe('emailSampleSignature', () => {
  it('groups emails by the X-GitHub-Reason header when present', () => {
    const first = email({ Subject: '[org/a] Thing (#12)', 'X-GitHub-Reason': 'review_requested' }, 'please review');
    const second = email({ Subject: '[org/b] Other (#99)', 'X-GitHub-Reason': 'review_requested' }, 'please review this one');
    expect(emailSampleSignature(first)).toBe(emailSampleSignature(second));
  });

  it('collapses different PR numbers to one subject signature when no reason header is present', () => {
    const first = email({ Subject: '[org/repo] Add thing (#41)' }, 'body one');
    const second = email({ Subject: '[org/repo] Fix bug (#87)' }, 'body two');
    // Same skeleton shape but different words still differ; identical wording with different numbers matches.
    const a = email({ Subject: '[org/repo] Deploy (#41)' }, 'x');
    const b = email({ Subject: '[org/repo] Deploy (#87)' }, 'y');
    expect(emailSampleSignature(a)).toBe(emailSampleSignature(b));
    expect(emailSampleSignature(first)).not.toBe(emailSampleSignature(second));
  });
});

describe('buildBulkRulePrompt', () => {
  it('returns an empty prompt for no samples', () => {
    const result = buildBulkRulePrompt([]);
    expect(result.prompt).toBe('');
    expect(result.representativeCount).toBe(0);
  });

  it('embeds one representative per distinct shape and asks for a rule SET', () => {
    const samples: EmailSample[] = [
      sample('a.eml', { Subject: '[org/r] A (#1)', 'X-GitHub-Reason': 'review_requested' }, 'please review'),
      sample('b.eml', { Subject: '[org/r] B (#2)', 'X-GitHub-Reason': 'review_requested' }, 'please review too'),
      sample('c.eml', { Subject: '[org/r] C (#3)', 'X-GitHub-Reason': 'push' }, 'pushed 2 commits'),
    ];
    const result = buildBulkRulePrompt(samples);
    // Two distinct reasons → two representatives, even though three emails were supplied.
    expect(result.representativeCount).toBe(2);
    expect(result.groupCount).toBe(2);
    expect(result.prompt).toContain('"kind": "githubEmailRuleSet"');
    expect(result.prompt).toContain('--- EMAIL 1 ---');
    expect(result.prompt).toContain('--- EMAIL 2 ---');
    expect(result.prompt).not.toContain('--- EMAIL 3 ---');
  });

  it('distills each email so the Subject, reason, and body survive huge leading headers (GH #262)', () => {
    // Simulate the real-world case: an enormous DKIM/ARC header block precedes the signal-bearing headers.
    // A blind raw slice would spend its whole budget here and cut off Subject / X-GitHub-Reason / body.
    const noiseHeader = 'DKIM-Signature: ' + 'a'.repeat(6000);
    const raw = [
      noiseHeader,
      'List-ID: r org <r.org.github.com>',
      'Subject: [org/r] Fix the thing (#7)',
      'X-GitHub-Reason: review_requested',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'octocat requested your review on this pull request.',
    ].join('\r\n');

    const result = buildBulkRulePrompt([{ fileName: 'big.eml', eventType: 'unknown', rawSource: raw }]);

    // The classification signals are present despite the 6 KB of leading header noise…
    expect(result.prompt).toContain('Subject: [org/r] Fix the thing (#7)');
    expect(result.prompt).toContain('X-GitHub-Reason: review_requested');
    expect(result.prompt).toContain('requested your review');
    // …and the raw DKIM noise is NOT dumped into the prompt.
    expect(result.prompt).not.toContain('DKIM-Signature');
  });

  it('strips the External-Sender banner and urldefense links so the body signal is not truncated away (GH #262)', () => {
    // A real enterprise body: the "approved" signal, then a Proofpoint banner and huge urldefense links that
    // used to consume the whole body budget and push the signal past the cap.
    const noisyBody = [
      '@octocat approved this pull request.',
      'ZjQcmQRYFpfptBannerStart',
      'This Message Is From an External Sender',
      'CAUTION: Do not click on links ' + '<https://us-phishalarm-ewt.proofpoint.com/EWT/v1/' + 'A'.repeat(2000) + '>',
      'Report Suspicious',
      'ZjQcmQRYFpfptBannerEnd',
      'Reply to this email directly, view it on GitHub <https://urldefense.com/v3/__' + 'B'.repeat(2000) + '>, or unsubscribe.',
    ].join('\n');
    const raw = email({ Subject: '[org/r] Thing (#5)', 'X-GitHub-Reason': 'subscribed' }, noisyBody);

    const result = buildBulkRulePrompt([{ fileName: 'noisy.eml', eventType: 'unknown', rawSource: raw }]);

    // The signal survives and the banner + giant links are gone — so the body is NOT truncated.
    expect(result.prompt).toContain('approved this pull request');
    expect(result.prompt).not.toContain('ZjQcmQRYFpfptBanner');
    expect(result.prompt).not.toContain('proofpoint.com');
    expect(result.prompt).not.toContain('urldefense.com');
    expect(result.prompt).not.toContain('(body truncated)');
  });

  it('caps only the body, keeping the header signals intact for a very long email', () => {
    const longBody = 'requested your review. ' + 'z'.repeat(5000);
    const raw = email({ Subject: '[org/r] Long (#3)', 'X-GitHub-Reason': 'review_requested' }, longBody);

    const result = buildBulkRulePrompt([{ fileName: 'long.eml', eventType: 'unknown', rawSource: raw }]);

    expect(result.prompt).toContain('X-GitHub-Reason: review_requested');
    expect(result.prompt).toContain('(body truncated)');
  });
});

describe('parseRuleReplyToList', () => {
  it('reads a bulk rule set of several rules', () => {
    const reply = JSON.stringify({
      kind: 'githubEmailRuleSet',
      rules: [
        { id: 'r-review', eventType: 'review_requested', reasonHeaderIn: ['review_requested'] },
        { id: 'r-push', eventType: 'commit_pushed', reasonHeaderIn: ['push'] },
      ],
    });
    const result = parseRuleReplyToList(reply);
    expect(result.ok).toBe(true);
    expect(result.rules).toHaveLength(2);
    expect(result.rules.map((rule) => rule.id).sort()).toEqual(['r-push', 'r-review']);
  });

  it('still accepts a single enveloped rule, and counts invalid rules as rejected', () => {
    const reply = JSON.stringify({
      kind: 'githubEmailRuleSet',
      rules: [
        { id: 'good', eventType: 'pr_merged', bodyPattern: 'merged into' },
        { id: '', eventType: 'pr_merged' },            // no id → rejected
        { id: 'no-matcher', eventType: 'pr_opened' },  // no matcher → rejected
      ],
    });
    const result = parseRuleReplyToList(reply);
    expect(result.ok).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.rejectedCount).toBe(2);
  });

  it('rejects a reply whose kind is for a different surface', () => {
    const reply = JSON.stringify({ kind: 'piReview', items: [] });
    const result = parseRuleReplyToList(reply);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('piReview');
  });
});
