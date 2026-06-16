// Unit tests for the outbound webhook host allow-list (security boundary).

'use strict';

const { isAllowed, evaluateHost } = require('./webhookHostPolicy');

describe('webhookHostPolicy', () => {
  describe('allowed destinations', () => {
    test('allows automation.atlassian.com over HTTPS', () => {
      expect(isAllowed('https://automation.atlassian.com/hook/abc')).toBe(true);
    });

    test('allows api-private.atlassian.com (Automation webhook host) over HTTPS', () => {
      expect(isAllowed('https://api-private.atlassian.com/automation/webhooks/abc')).toBe(true);
    });

    test('allows any *.atlassian.net subdomain over HTTPS', () => {
      expect(isAllowed('https://mycompany.atlassian.net/rest/webhook')).toBe(true);
    });

    test('is case-insensitive on the hostname', () => {
      expect(isAllowed('https://MyCompany.Atlassian.Net/x')).toBe(true);
    });
  });

  describe('rejected destinations', () => {
    test('rejects non-HTTPS (http) Atlassian URLs', () => {
      const result = evaluateHost('http://mycompany.atlassian.net/x');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/HTTPS/i);
    });

    test('rejects an unrelated host', () => {
      expect(isAllowed('https://example.com/hook')).toBe(false);
    });

    test('rejects a suffix look-alike (evil-atlassian.net.attacker.com)', () => {
      expect(isAllowed('https://evil-atlassian.net.attacker.com/hook')).toBe(false);
    });

    test('rejects a substring trick (notatlassian.net)', () => {
      expect(isAllowed('https://notatlassian.net/hook')).toBe(false);
    });

    test('rejects a .atlassian.com look-alike (evil-atlassian.com.attacker.com)', () => {
      expect(isAllowed('https://evil-atlassian.com.attacker.com/hook')).toBe(false);
    });

    test('rejects bare atlassian.net with no subdomain', () => {
      expect(isAllowed('https://atlassian.net/hook')).toBe(false);
    });

    test('rejects a malformed URL', () => {
      const result = evaluateHost('not a url');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/valid URL/i);
    });
  });
});
