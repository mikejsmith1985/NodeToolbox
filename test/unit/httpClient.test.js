// test/unit/httpClient.test.js — Unit tests for the HTTP client utility module.
// Tests authentication header construction for all credential combinations.

'use strict';

const { buildBasicAuthHeader, buildAuthHeader } = require('../../src/utils/httpClient');

// ── buildBasicAuthHeader() ────────────────────────────────────────────────────

describe('buildBasicAuthHeader()', () => {
  it('returns null when username is missing', () => {
    expect(buildBasicAuthHeader('', 'secret')).toBeNull();
    expect(buildBasicAuthHeader(null, 'secret')).toBeNull();
  });

  it('returns null when password is missing', () => {
    expect(buildBasicAuthHeader('user', '')).toBeNull();
    expect(buildBasicAuthHeader('user', null)).toBeNull();
  });

  it('returns null when both username and password are missing', () => {
    expect(buildBasicAuthHeader('', '')).toBeNull();
  });

  it('returns a correctly encoded Basic Auth header', () => {
    // "user:secret" in base64 is "dXNlcjpzZWNyZXQ="
    const expectedHeaderValue = 'Basic ' + Buffer.from('user:secret').toString('base64');
    expect(buildBasicAuthHeader('user', 'secret')).toBe(expectedHeaderValue);
  });

  it('handles email addresses as usernames correctly', () => {
    const expectedHeaderValue = 'Basic ' + Buffer.from('user@company.com:api-token').toString('base64');
    expect(buildBasicAuthHeader('user@company.com', 'api-token')).toBe(expectedHeaderValue);
  });
});

// ── buildAuthHeader() ─────────────────────────────────────────────────────────

describe('buildAuthHeader()', () => {
  it('returns null when no credentials are configured', () => {
    expect(buildAuthHeader({ pat: '', username: '', apiToken: '' })).toBeNull();
    expect(buildAuthHeader({})).toBeNull();
  });

  it('returns a Bearer header when a PAT is configured', () => {
    const serviceConfig = { pat: 'my-personal-access-token', username: '', apiToken: '' };
    expect(buildAuthHeader(serviceConfig)).toBe('Bearer my-personal-access-token');
  });

  it('PAT takes priority over Basic Auth credentials', () => {
    // When both PAT and Basic credentials exist, PAT wins (SSO environments prefer PAT)
    const serviceConfig = { pat: 'pat-takes-priority', username: 'user', apiToken: 'token' };
    const headerValue = buildAuthHeader(serviceConfig);
    expect(headerValue).toBe('Bearer pat-takes-priority');
  });

  it('falls back to Basic Auth when no PAT is configured', () => {
    const serviceConfig = { pat: '', username: 'user@company.com', apiToken: 'api-token-123' };
    const expectedBasic = 'Basic ' + Buffer.from('user@company.com:api-token-123').toString('base64');
    expect(buildAuthHeader(serviceConfig)).toBe(expectedBasic);
  });

  it('uses password field as Basic Auth credential when apiToken is absent', () => {
    const serviceConfig = { pat: '', username: 'snow-user', password: 'snow-pass', apiToken: '' };
    const expectedBasic = 'Basic ' + Buffer.from('snow-user:snow-pass').toString('base64');
    expect(buildAuthHeader(serviceConfig)).toBe(expectedBasic);
  });

  it('apiToken takes priority over password when both are present', () => {
    const serviceConfig = {
      pat: '', username: 'user', apiToken: 'token-wins', password: 'password-loses'
    };
    const expectedBasic = 'Basic ' + Buffer.from('user:token-wins').toString('base64');
    expect(buildAuthHeader(serviceConfig)).toBe(expectedBasic);
  });
});
