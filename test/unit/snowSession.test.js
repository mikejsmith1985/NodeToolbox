// test/unit/snowSession.test.js — Unit tests for the SNow session store.
// Verifies that session tokens are stored, expired, and cleared correctly,
// and that the raw g_ck token is never surfaced in status responses.

'use strict';

const snowSession = require('../../src/services/snowSession');

describe('snowSession', () => {
  // Reset session state between every test to prevent bleed-over
  afterEach(() => snowSession.clearSession());

  // ── storeSession ──────────────────────────────────────────────────────────

  describe('storeSession', () => {
    it('activates the session so isSessionActive returns true', () => {
      snowSession.storeSession('test-gck', 'https://snow.example.com', 3600);
      expect(snowSession.isSessionActive()).toBe(true);
    });

    it('stores the base URL provided at handoff time', () => {
      snowSession.storeSession('test-gck', 'https://snow.example.com', 3600);
      expect(snowSession.getSessionStatus().baseUrl).toBe('https://snow.example.com');
    });

    it('marks the session as expired after the lifetime has elapsed', () => {
      // Lifetime of 0 seconds expires immediately
      snowSession.storeSession('test-gck', 'https://snow.example.com', 0);
      expect(snowSession.isSessionActive()).toBe(false);
    });
  });

  // ── getSessionStatus ──────────────────────────────────────────────────────

  describe('getSessionStatus', () => {
    it('returns hasSession: true when a session is stored', () => {
      snowSession.storeSession('gck-value', 'https://snow.example.com', 3600);
      expect(snowSession.getSessionStatus().hasSession).toBe(true);
    });

    it('returns hasSession: false before any session is stored', () => {
      expect(snowSession.getSessionStatus().hasSession).toBe(false);
    });

    it('never includes the raw token in the status response', () => {
      const secretToken = 'super-secret-gck-12345';
      snowSession.storeSession(secretToken, 'https://snow.example.com', 3600);
      const statusJson = JSON.stringify(snowSession.getSessionStatus());
      expect(statusJson).not.toContain(secretToken);
    });

    it('returns an expiresAt timestamp when a session is active', () => {
      snowSession.storeSession('gck', 'https://snow.example.com', 3600);
      expect(snowSession.getSessionStatus().expiresAt).toBeGreaterThan(0);
    });
  });

  // ── clearSession ──────────────────────────────────────────────────────────

  describe('clearSession', () => {
    it('deactivates an active session', () => {
      snowSession.storeSession('gck', 'https://snow.example.com', 3600);
      snowSession.clearSession();
      expect(snowSession.isSessionActive()).toBe(false);
    });

    it('sets hasSession to false after clearing', () => {
      snowSession.storeSession('gck', 'https://snow.example.com', 3600);
      snowSession.clearSession();
      expect(snowSession.getSessionStatus().hasSession).toBe(false);
    });
  });

  // ── buildSessionHeaders ───────────────────────────────────────────────────

  describe('buildSessionHeaders', () => {
    it('returns X-UserToken header when session is active', () => {
      snowSession.storeSession('active-gck', 'https://snow.example.com', 3600);
      const headers = snowSession.buildSessionHeaders();
      expect(headers['X-UserToken']).toBe('active-gck');
    });

    it('returns an empty object when no session is active', () => {
      const headers = snowSession.buildSessionHeaders();
      expect(Object.keys(headers).length).toBe(0);
    });
  });

  // ── resolveSnowBaseUrl ────────────────────────────────────────────────────

  describe('resolveSnowBaseUrl', () => {
    it('returns the session base URL when a session is active', () => {
      snowSession.storeSession('gck', 'https://session.snow.example.com', 3600);
      const resolvedUrl = snowSession.resolveSnowBaseUrl('https://config.snow.example.com');
      expect(resolvedUrl).toBe('https://session.snow.example.com');
    });

    it('returns the config base URL when no session is active', () => {
      const resolvedUrl = snowSession.resolveSnowBaseUrl('https://config.snow.example.com');
      expect(resolvedUrl).toBe('https://config.snow.example.com');
    });
  });
});
