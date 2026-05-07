// jiraApi.test.ts — Unit tests for the typed Jira proxy client.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet, jiraPost, jiraPut } from './jiraApi.ts';

const JIRA_PATH = '/rest/api/3/issue/ABC-123';
const JIRA_RESPONSE = { key: 'ABC-123' };
const JIRA_CREATE_PATH = '/rest/api/3/issue';
const JIRA_CREATE_BODY = { fields: { summary: 'Create story' } };
const JIRA_UPDATE_PATH = '/rest/api/2/issue/ABC-123';
const JIRA_UPDATE_BODY = { fields: { customfield_10016: 5 } };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
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
});
