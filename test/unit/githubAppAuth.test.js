// test/unit/githubAppAuth.test.js — Unit tests for the GitHub App authentication service.
// Tests JWT generation, installation token fetching, caching, and credential detection.
// HTTP calls to GitHub's token endpoint are intercepted with nock — no real network traffic.

'use strict';

const crypto = require('crypto');
const nock   = require('nock');

const {
  generateGitHubAppJwt,
  fetchInstallationToken,
  getValidInstallationToken,
  clearInstallationTokenCache,
  hasGitHubAppCredentials,
} = require('../../src/services/githubAppAuth');

// ── Test key pair ─────────────────────────────────────────────────────────────

// A real RSA-2048 key pair used to sign and verify JWTs in tests.
// Generated once per test suite run — synchronous key generation is fine here.
let testPrivateKeyPem;
let testPublicKeyPem;

beforeAll(() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  testPublicKeyPem  = publicKey.export({ type: 'spki',  format: 'pem' });
});

// ── generateGitHubAppJwt ──────────────────────────────────────────────────────

describe('generateGitHubAppJwt', () => {
  it('returns a three-segment JWT string (header.payload.signature)', () => {
    const jwt      = generateGitHubAppJwt('12345', testPrivateKeyPem);
    const segments = jwt.split('.');
    expect(segments).toHaveLength(3);
  });

  it('encodes alg:RS256 in the header segment', () => {
    const jwt          = generateGitHubAppJwt('12345', testPrivateKeyPem);
    const headerBase64 = jwt.split('.')[0];
    const header       = JSON.parse(Buffer.from(headerBase64, 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
  });

  it('encodes the appId as the iss (issuer) claim', () => {
    const jwt           = generateGitHubAppJwt('987', testPrivateKeyPem);
    const payloadBase64 = jwt.split('.')[1];
    const payload       = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());
    expect(payload.iss).toBe('987');
  });

  it('sets iat in the past and exp roughly 9 minutes ahead', () => {
    const beforeMs      = Date.now();
    const jwt           = generateGitHubAppJwt('1', testPrivateKeyPem);
    const afterMs       = Date.now();
    const payloadBase64 = jwt.split('.')[1];
    const payload       = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());
    const nowSec        = Math.floor(beforeMs / 1000);

    // iat is back-dated by 60s for clock skew tolerance
    expect(payload.iat).toBeLessThanOrEqual(nowSec);
    expect(payload.iat).toBeGreaterThan(Math.floor(afterMs / 1000) - 120);

    // exp is iat + 540s (9 minutes)
    expect(payload.exp - payload.iat).toBe(540);
  });

  it('produces an RS256 signature verifiable with the corresponding public key', () => {
    const jwt                    = generateGitHubAppJwt('12345', testPrivateKeyPem);
    const [header, payload, sig] = jwt.split('.');
    const verifier               = crypto.createVerify('RSA-SHA256');
    verifier.update(header + '.' + payload);
    const isValid = verifier.verify(testPublicKeyPem, Buffer.from(sig, 'base64url'));
    expect(isValid).toBe(true);
  });
});

// ── fetchInstallationToken ────────────────────────────────────────────────────

describe('fetchInstallationToken', () => {
  afterEach(() => nock.cleanAll());

  it('POSTs to /app/installations/:id/access_tokens and returns token + expiresAt', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    nock('https://api.github.com')
      .post('/app/installations/999/access_tokens')
      .reply(201, { token: 'ghs_test_installation_token', expires_at: expiresAt });

    const result = await fetchInstallationToken(
      '42', '999', testPrivateKeyPem, 'https://api.github.com', true
    );

    expect(result.token).toBe('ghs_test_installation_token');
    expect(result.expiresAt).toBe(expiresAt);
  });

  it('rejects with a descriptive error when GitHub returns HTTP 401', async () => {
    nock('https://api.github.com')
      .post('/app/installations/999/access_tokens')
      .reply(401, { message: 'Bad credentials' });

    await expect(
      fetchInstallationToken('42', '999', testPrivateKeyPem, 'https://api.github.com', true)
    ).rejects.toThrow(/401.*Bad credentials/);
  });

  it('rejects with a descriptive error when GitHub returns HTTP 404 (installation not found)', async () => {
    nock('https://api.github.com')
      .post('/app/installations/000/access_tokens')
      .reply(404, { message: 'Not Found' });

    await expect(
      fetchInstallationToken('42', '000', testPrivateKeyPem, 'https://api.github.com', true)
    ).rejects.toThrow(/404/);
  });
});

// ── hasGitHubAppCredentials ───────────────────────────────────────────────────

describe('hasGitHubAppCredentials', () => {
  it('returns false when the github config is empty', () => {
    expect(hasGitHubAppCredentials({ github: {} })).toBe(false);
  });

  it('returns false when appId is present but installationId and appPrivateKey are missing', () => {
    expect(hasGitHubAppCredentials({ github: { appId: '1' } })).toBe(false);
  });

  it('returns false when appPrivateKey is missing', () => {
    expect(hasGitHubAppCredentials({ github: { appId: '1', installationId: '2' } })).toBe(false);
  });

  it('returns true when all three credentials are present', () => {
    const configuration = { github: { appId: '1', installationId: '2', appPrivateKey: 'pem-data' } };
    expect(hasGitHubAppCredentials(configuration)).toBe(true);
  });
});

// ── getValidInstallationToken ─────────────────────────────────────────────────

describe('getValidInstallationToken', () => {
  // Always clear the module-level token cache between test cases
  beforeEach(() => clearInstallationTokenCache());
  afterEach(() => nock.cleanAll());

  function buildTestConfig() {
    return {
      github: {
        appId:         '42',
        installationId: '999',
        appPrivateKey:  testPrivateKeyPem,
        baseUrl:        'https://api.github.com',
      },
      sslVerify: true,
    };
  }

  it('fetches a new token when the cache is empty', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    nock('https://api.github.com')
      .post('/app/installations/999/access_tokens')
      .reply(201, { token: 'ghs_fresh', expires_at: expiresAt });

    const token = await getValidInstallationToken(buildTestConfig());
    expect(token).toBe('ghs_fresh');
  });

  it('reuses the cached token without making a second HTTP call', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    // Register the nock interceptor for exactly one call — a second call would fail
    nock('https://api.github.com')
      .post('/app/installations/999/access_tokens')
      .once()
      .reply(201, { token: 'ghs_cached', expires_at: expiresAt });

    const configuration = buildTestConfig();
    await getValidInstallationToken(configuration);
    const secondToken = await getValidInstallationToken(configuration);

    expect(secondToken).toBe('ghs_cached');
    // nock.isDone() confirms all registered interceptors were consumed (exactly once)
    expect(nock.isDone()).toBe(true);
  });

  it('rejects with an "incomplete" error when any credential is missing', async () => {
    const configuration = { github: {}, sslVerify: true };
    await expect(getValidInstallationToken(configuration)).rejects.toThrow(/incomplete/i);
  });
});
