// test/unit/httpClient.test.js — Unit tests for the HTTP client utility module.
// Tests authentication header construction, proxy body forwarding, and error handling.

'use strict';

const http = require('http');
const { buildBasicAuthHeader, buildAuthHeader, proxyRequest } = require('../../src/utils/httpClient');

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

// ── proxyRequest() — body forwarding ─────────────────────────────────────────

describe('proxyRequest() body forwarding', () => {
  const { Writable } = require('stream');
  let upstreamServer;
  let upstreamPort;
  let receivedBody;
  let receivedContentLength;

  /**
   * Creates a mock Express Response that is also a proper Writable stream so
   * proxyRequest() can call upstreamResponse.pipe(mockClientRes) without error.
   */
  function createMockClientRes() {
    const mockWritable = new Writable({
      write(chunk, _encoding, callback) { callback(); },
    });
    mockWritable.headersSent = false;
    mockWritable._statusCode = null;
    mockWritable._jsonPayload = null;
    mockWritable.status  = function(code)    { this._statusCode = code; return this; };
    mockWritable.json    = function(payload) { this._jsonPayload = payload; };
    mockWritable.setHeader = function() {};
    return mockWritable;
  }

  beforeAll((done) => {
    // Spin up a real HTTP server that captures what the proxy sends
    upstreamServer = http.createServer((req, res) => {
      receivedContentLength = req.headers['content-length'];
      const bodyChunks = [];
      req.on('data', (chunk) => bodyChunks.push(chunk));
      req.on('end', () => {
        receivedBody = Buffer.concat(bodyChunks).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    upstreamServer.listen(0, '127.0.0.1', () => {
      upstreamPort = upstreamServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    upstreamServer.close(done);
  });

  beforeEach(() => {
    receivedBody          = undefined;
    receivedContentLength = undefined;
  });

  it('forwards a pre-parsed JSON body (express.json() already consumed the stream)', (done) => {
    // Simulate Express: body-parser has parsed the JSON and attached it to req.body.
    // The readable stream is already consumed (ended) so piping would send empty bytes.
    const mockClientReq = {
      method:  'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body:    { title: 'Test issue', priority: 'high' },  // populated by express.json()
      pipe:    () => { throw new Error('pipe() must not be called when body is pre-parsed'); },
    };
    const serviceConfig  = { baseUrl: `http://127.0.0.1:${upstreamPort}` };
    const mockClientRes  = createMockClientRes();

    proxyRequest(mockClientReq, mockClientRes, serviceConfig, '/test-path', null, false);

    // Give the upstream server time to receive and respond
    setTimeout(() => {
      const parsedBody = JSON.parse(receivedBody);
      expect(parsedBody.title).toBe('Test issue');
      expect(parsedBody.priority).toBe('high');
      expect(parseInt(receivedContentLength, 10)).toBeGreaterThan(0);
      done();
    }, 300);
  });

  it('falls back to piping when body has not been pre-parsed (stream is fresh)', (done) => {
    const { Readable } = require('stream');

    const rawPayload     = Buffer.from('raw-binary-data', 'utf8');
    const readableStream = Readable.from([rawPayload]);

    const mockClientReq = Object.assign(readableStream, {
      method:  'PUT',
      headers: { 'content-type': 'application/octet-stream', accept: '*/*' },
      // body is intentionally absent (undefined) — express.json() skipped non-JSON content
    });

    const serviceConfig = { baseUrl: `http://127.0.0.1:${upstreamPort}` };
    const mockClientRes = createMockClientRes();

    proxyRequest(mockClientReq, mockClientRes, serviceConfig, '/test-raw', null, false);

    setTimeout(() => {
      expect(receivedBody).toBe('raw-binary-data');
      done();
    }, 300);
  });

  it('returns 502 with a non-empty message when the upstream connection is refused', (done) => {
    // Port 1 is reserved and always refused — triggers a network error
    const mockClientReq = {
      method:  'GET',
      headers: { accept: 'application/json' },
      body:    undefined,
    };
    const serviceConfig = { baseUrl: 'http://127.0.0.1:1' };
    const mockClientRes = createMockClientRes();

    proxyRequest(mockClientReq, mockClientRes, serviceConfig, '/refused', null, false);

    setTimeout(() => {
      expect(mockClientRes._statusCode).toBe(502);
      expect(mockClientRes._jsonPayload.error).toBe('Proxy error');
      // message must never be an empty string
      expect(mockClientRes._jsonPayload.message.length).toBeGreaterThan(0);
      done();
    }, 500);
  });
});
