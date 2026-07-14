// src/utils/httpClient.test.js — Unit tests for pure helpers in the HTTP client util.

'use strict';

const { resolveWebhookTriggeredBy } = require('./httpClient');

describe('resolveWebhookTriggeredBy', () => {
  it('returns the trimmed Jira username so automations can identify the firing instance', () => {
    expect(resolveWebhookTriggeredBy({ username: '  mikej@work.com  ' })).toBe('mikej@work.com');
  });

  it('returns undefined when the username is missing, empty, or the config is absent', () => {
    expect(resolveWebhookTriggeredBy({ username: '' })).toBeUndefined();
    expect(resolveWebhookTriggeredBy({ username: '   ' })).toBeUndefined();
    expect(resolveWebhookTriggeredBy({})).toBeUndefined();
    expect(resolveWebhookTriggeredBy(null)).toBeUndefined();
    expect(resolveWebhookTriggeredBy(undefined)).toBeUndefined();
  });

  it('ignores a non-string username', () => {
    expect(resolveWebhookTriggeredBy({ username: 12345 })).toBeUndefined();
  });
});
