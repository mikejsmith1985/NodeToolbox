// jiraApi.test.ts — Unit tests for the typed Jira proxy client.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet, jiraPost, jiraPut, type JiraApiEventDetail } from './jiraApi.ts';

const JIRA_PATH = '/rest/api/3/issue/ABC-123';
const JIRA_RESPONSE = { key: 'ABC-123' };
const JIRA_CREATE_PATH = '/rest/api/3/issue';
const JIRA_CREATE_BODY = { fields: { summary: 'Create story' } };
const JIRA_UPDATE_PATH = '/rest/api/2/issue/ABC-123';
const JIRA_UPDATE_BODY = { fields: { customfield_10016: 5 } };

let recordedEvents: JiraApiEventDetail[];
const recordEvent = (event: Event): void => {
  recordedEvents.push((event as CustomEvent<JiraApiEventDetail>).detail);
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  recordedEvents = [];
  window.addEventListener('toolbox:api', recordEvent);
});

afterEach(() => {
  window.removeEventListener('toolbox:api', recordEvent);
});

describe('jiraApi', () => {
  it('jiraGet builds the Jira proxy URL and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(JIRA_RESPONSE),
    } as unknown as Response);

    await expect(jiraGet<typeof JIRA_RESPONSE>(JIRA_PATH)).resolves.toEqual(JIRA_RESPONSE);
    expect(fetch).toHaveBeenCalledWith(`/jira-proxy${JIRA_PATH}`);
  });

  it('jiraGet throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(jiraGet(JIRA_PATH)).rejects.toThrow('Jira GET /rest/api/3/issue/ABC-123 failed: 503');
  });

  it('jiraPost sends JSON with the expected headers', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(JIRA_RESPONSE),
    } as unknown as Response);

    await expect(jiraPost<typeof JIRA_RESPONSE>(JIRA_CREATE_PATH, JIRA_CREATE_BODY)).resolves.toEqual(
      JIRA_RESPONSE,
    );
    expect(fetch).toHaveBeenCalledWith(`/jira-proxy${JIRA_CREATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JIRA_CREATE_BODY),
    });
  });

  it('jiraPost throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(jiraPost(JIRA_CREATE_PATH, JIRA_CREATE_BODY)).rejects.toThrow(
      'Jira POST /rest/api/3/issue failed: 400',
    );
  });

  it('jiraPut sends JSON with the expected headers and resolves on success', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    await expect(jiraPut(JIRA_UPDATE_PATH, JIRA_UPDATE_BODY)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(`/jira-proxy${JIRA_UPDATE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JIRA_UPDATE_BODY),
    });
  });

  it('jiraPut throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(jiraPut(JIRA_UPDATE_PATH, JIRA_UPDATE_BODY)).rejects.toThrow(
      'Jira PUT /rest/api/2/issue/ABC-123 failed: 401',
    );
  });

  it('emits a toolbox:api CustomEvent on successful GET with method, url, status, and duration', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(JIRA_RESPONSE),
    } as unknown as Response);

    await jiraGet(JIRA_PATH);

    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({
      method: 'GET',
      url: JIRA_PATH,
      status: 200,
      errorMessage: null,
    });
    expect(typeof recordedEvents[0].durationMs).toBe('number');
  });

  it('emits a toolbox:api CustomEvent with parsed status code on a failing GET', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(jiraGet(JIRA_PATH)).rejects.toThrow();
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({
      method: 'GET',
      url: JIRA_PATH,
      status: 503,
    });
    expect(recordedEvents[0].errorMessage).toContain('503');
  });

  it('emits a toolbox:api CustomEvent with method=POST on jiraPost calls', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue(JIRA_RESPONSE),
    } as unknown as Response);

    await jiraPost(JIRA_CREATE_PATH, JIRA_CREATE_BODY);

    expect(recordedEvents[0].method).toBe('POST');
    expect(recordedEvents[0].url).toBe(JIRA_CREATE_PATH);
    expect(recordedEvents[0].status).toBe(201);
  });

  it('emits a toolbox:api CustomEvent with method=PUT on jiraPut calls', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 204 } as Response);

    await jiraPut(JIRA_UPDATE_PATH, JIRA_UPDATE_BODY);

    expect(recordedEvents[0].method).toBe('PUT');
    expect(recordedEvents[0].url).toBe(JIRA_UPDATE_PATH);
    expect(recordedEvents[0].status).toBe(204);
  });
});
