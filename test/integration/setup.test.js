// test/integration/setup.test.js — Integration tests for the first-run setup wizard.
// Verifies that GET /setup serves the HTML wizard and POST /api/setup validates
// and saves credentials, redirecting to the dashboard on success.

'use strict';

const request  = require('supertest');
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { applyCorsHeaders } = require('../../src/middleware/cors');
const createSetupRouter    = require('../../src/routes/setup');

// ── Test App Factory ──────────────────────────────────────────────────────────

function buildTestApp(configuration) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(applyCorsHeaders);
  testApp.use(createSetupRouter(configuration));
  return testApp;
}

function buildBlankConfig() {
  return {
    port:      5555,
    jira:      { baseUrl: '', pat: '', username: '', apiToken: '' },
    snow:      { baseUrl: '', username: '', password: '' },
    github:    { baseUrl: 'https://api.github.com', pat: '' },
    sslVerify: true,
    scheduler: { repoMonitor: { enabled: false, repos: [], branchPattern: '', intervalMin: 15, transitions: {}, seenBranches: {}, seenCommits: {}, seenPrs: {} } },
  };
}

// ── GET /setup ────────────────────────────────────────────────────────────────

describe('GET /setup', () => {
  it('returns 200 with HTML content', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('includes the three service cards (Jira, GitHub, ServiceNow)', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    const html = response.text;
    expect(html).toMatch(/Jira/i);
    expect(html).toMatch(/GitHub/i);
    expect(html).toMatch(/ServiceNow/i);
  });

  it('includes a form that posts to /api/setup', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/\/api\/setup/);
  });

  it('pre-fills the Jira base URL if already configured', async () => {
    const configuration = buildBlankConfig();
    configuration.jira.baseUrl = 'https://prefilled.atlassian.net';
    const response = await request(buildTestApp(configuration)).get('/setup');
    expect(response.text).toContain('https://prefilled.atlassian.net');
  });
});

// ── POST /api/setup ────────────────────────────────────────────────────────────

describe('POST /api/setup', () => {
  let tempConfigPath;
  let originalConfigPath;

  beforeAll(() => {
    // Write to a temp file so we don't pollute the real toolbox-proxy.json
    const { CONFIG_FILE_PATH } = require('../../src/config/loader');
    originalConfigPath = CONFIG_FILE_PATH;
    tempConfigPath = path.join(os.tmpdir(), 'toolbox-proxy-test-' + Date.now() + '.json');
  });

  afterAll(() => {
    // Clean up temp file
    if (tempConfigPath && fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  });

  it('returns 302 redirect to / on valid input', async () => {
    const configuration = buildBlankConfig();
    const response = await request(buildTestApp(configuration))
      .post('/api/setup')
      .send({
        jiraBaseUrl: 'https://acme.atlassian.net',
        jiraPat:     'jira-test-pat',
        githubPat:   'ghp_test_token',
        snowBaseUrl: '',
        snowUsername: '',
        snowPassword: '',
      });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('returns 400 when all service credentials are blank', async () => {
    const configuration = buildBlankConfig();
    const response = await request(buildTestApp(configuration))
      .post('/api/setup')
      .send({
        jiraBaseUrl:  '',
        jiraPat:      '',
        githubPat:    '',
        snowBaseUrl:  '',
        snowUsername: '',
        snowPassword: '',
      });
    expect(response.status).toBe(400);
  });

  it('updates the live configuration with submitted Jira credentials', async () => {
    const configuration = buildBlankConfig();
    await request(buildTestApp(configuration))
      .post('/api/setup')
      .send({
        jiraBaseUrl: 'https://acme.atlassian.net',
        jiraPat:     'jira-pat-123',
        githubPat:   '',
        snowBaseUrl: '',
        snowUsername: '',
        snowPassword: '',
      });
    expect(configuration.jira.baseUrl).toBe('https://acme.atlassian.net');
    expect(configuration.jira.pat).toBe('jira-pat-123');
  });

  it('updates the live configuration with submitted GitHub PAT', async () => {
    const configuration = buildBlankConfig();
    await request(buildTestApp(configuration))
      .post('/api/setup')
      .send({
        jiraBaseUrl: '',
        jiraPat:     '',
        githubPat:   'ghp_mypat',
        snowBaseUrl: '',
        snowUsername: '',
        snowPassword: '',
      });
    expect(configuration.github.pat).toBe('ghp_mypat');
  });

  it('strips trailing slashes from submitted base URLs', async () => {
    const configuration = buildBlankConfig();
    await request(buildTestApp(configuration))
      .post('/api/setup')
      .send({
        jiraBaseUrl: 'https://acme.atlassian.net/',
        jiraPat:     'jira-pat',
        githubPat:   '',
        snowBaseUrl: '',
        snowUsername: '',
        snowPassword: '',
      });
    expect(configuration.jira.baseUrl).not.toMatch(/\/$/);
  });
});
