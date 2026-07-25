// githubRulePrompt.test.ts — The AI-assist rule prompt and reply parser, plus the custom-rule compile path.

import { describe, expect, it } from 'vitest';

import { parseGithubEmail } from './classifyGithubEmail.ts';
import { compileCustomRules, validateSerializedRule, type SerializedEmailRule } from './githubEmailRules.ts';
import { buildRulePrompt, parseRuleReply } from './githubRulePrompt.ts';

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
