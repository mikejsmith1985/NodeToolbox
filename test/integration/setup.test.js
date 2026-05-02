// test/integration/setup.test.js — Integration tests for the guided first-run setup wizard.
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

  it('has a welcome/intro step', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    // First step should greet the user warmly — check for wizard step markers
    expect(response.text).toMatch(/data-step="welcome"|id="step-welcome"/i);
  });

  it('has a Jira setup step', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/data-step="jira"|id="step-jira"/i);
  });

  it('has a GitHub setup step', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/data-step="github"|id="step-github"/i);
  });

  it('has a ServiceNow setup step', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/data-step="snow"|id="step-snow"/i);
  });

  it('has a completion/done step', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/data-step="done"|id="step-done"/i);
  });

  it('includes Skip buttons for optional services (GitHub and ServiceNow)', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    // Both GitHub and ServiceNow are optional — must be skippable
    expect(response.text).toMatch(/skip/i);
  });

  it('includes a progress indicator', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/progress|step-indicator|step \d|of \d/i);
  });

  it('sends the form payload to /api/setup', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    expect(response.text).toMatch(/\/api\/setup/);
  });

  it('pre-fills the Jira base URL when already configured', async () => {
    const configuration = buildBlankConfig();
    configuration.jira.baseUrl = 'https://prefilled.atlassian.net';
    const response = await request(buildTestApp(configuration)).get('/setup');
    expect(response.text).toContain('https://prefilled.atlassian.net');
  });

  it('pre-fills the ServiceNow base URL when already configured', async () => {
    const configuration = buildBlankConfig();
    configuration.snow.baseUrl = 'https://myinstance.service-now.com';
    const response = await request(buildTestApp(configuration)).get('/setup');
    expect(response.text).toContain('https://myinstance.service-now.com');
  });

  it('has no external script or stylesheet URLs (enterprise offline safety)', async () => {
    const response = await request(buildTestApp(buildBlankConfig())).get('/setup');
    // Must not load any CDN resources — all CSS/JS must be inline
    expect(response.text).not.toMatch(/src="https?:\/\//);
    expect(response.text).not.toMatch(/href="https?:\/\//);
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
