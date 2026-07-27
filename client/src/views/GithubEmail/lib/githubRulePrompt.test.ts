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

  it('rejects an unknown event type', () => {
    const result = parseRuleReply('{"id":"x","eventType":"nonsense","bodyPattern":"a"}');
    expect(result.ok).toBe(false);
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
      { id: '', eventType: 'pr_opened', reasonHeaderIn: ['x'] }, // no id
      { id: 'bad', eventType: 'nope', bodyPattern: 'x' },        // bad event
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
