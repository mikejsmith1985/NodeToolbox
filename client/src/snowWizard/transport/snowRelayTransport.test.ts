// snowRelayTransport.test.ts — Proves Toolbox's ServiceNow relay requests cross to the ServiceNow tab exactly as the old
// relay sent them (JSON as text, files as base64 bytes) and that the tab's answers come back in the relay's result shape.

import { describe, expect, it, vi } from 'vitest';

import type { RelayRequest } from '../../types/relay.ts';
import type { AgentTransport } from './agentTransport.ts';
import { createSnowRelayTransport, toRelayResult, toSnowAgentRequest } from './snowRelayTransport.ts';

function buildRelayRequest(overrides: Partial<RelayRequest> = {}): RelayRequest {
  return { sys: 'snow', id: 'req-1', method: 'get', path: '/api/now/table/change_request', ...overrides };
}

describe('toSnowAgentRequest', () => {
  it('upper-cases the method and sends no body when there is none', () => {
    expect(toSnowAgentRequest(buildRelayRequest())).toEqual({ method: 'GET', path: '/api/now/table/change_request' });
    expect(toSnowAgentRequest(buildRelayRequest({ body: null }))).toEqual({ method: 'GET', path: '/api/now/table/change_request' });
  });

  it('defaults a missing method to GET', () => {
    expect(toSnowAgentRequest(buildRelayRequest({ method: '' })).method).toBe('GET');
  });

  it('turns a JSON object body into the exact text ServiceNow should receive', () => {
    const agentRequest = toSnowAgentRequest(buildRelayRequest({ method: 'patch', body: { short_description: 'Fix login' } }));
    expect(agentRequest).toEqual({ method: 'PATCH', path: '/api/now/table/change_request', body: '{"short_description":"Fix login"}' });
  });

  it('passes a string body through untouched', () => {
    expect(toSnowAgentRequest(buildRelayRequest({ method: 'POST', body: 'already text' })).body).toBe('already text');
  });

  it('keeps a base64 file body as base64 with its content type', () => {
    const agentRequest = toSnowAgentRequest(buildRelayRequest({ method: 'POST', body: 'UEsDBA==', bodyEncoding: 'base64', contentType: 'application/zip' }));
    expect(agentRequest).toEqual({ method: 'POST', path: '/api/now/table/change_request', body: 'UEsDBA==', bodyEncoding: 'base64', contentType: 'application/zip' });
  });

  it('sends a base64 body with no content type as raw bytes (application/octet-stream)', () => {
    const agentRequest = toSnowAgentRequest(buildRelayRequest({ method: 'POST', body: 'AAE=', bodyEncoding: 'base64', contentType: null }));
    expect(agentRequest.contentType).toBe('application/octet-stream');
    expect(agentRequest.bodyEncoding).toBe('base64');
  });

  it('carries the longer wait Toolbox asks for on slow calls', () => {
    expect(toSnowAgentRequest(buildRelayRequest({ timeoutMs: 120_000 })).timeoutMs).toBe(120_000);
  });
});

describe('toRelayResult', () => {
  it('is ok for every 2xx answer and carries the body as data', () => {
    expect(toRelayResult('req-1', { status: 200, body: '{"result":[]}' })).toEqual({ id: 'req-1', ok: true, status: 200, data: '{"result":[]}', error: null });
    expect(toRelayResult('req-1', { status: 204, body: '' }).ok).toBe(true);
  });

  it('is not ok for a ServiceNow error, but still carries what ServiceNow said', () => {
    expect(toRelayResult('req-1', { status: 403, body: 'denied' })).toEqual({ id: 'req-1', ok: false, status: 403, data: 'denied', error: null });
  });

  it('carries the reason as the error when ServiceNow was never reached (status 0)', () => {
    expect(toRelayResult('req-1', { status: 0, body: 'The ServiceNow tab was closed' }))
      .toEqual({ id: 'req-1', ok: false, status: 0, data: null, error: 'The ServiceNow tab was closed' });
  });
});

describe('createSnowRelayTransport', () => {
  it('runs each relay request in the ServiceNow tab and answers in the relay result shape', async () => {
    const execute = vi.fn(async () => ({ status: 201, body: '{"result":{}}' }));
    const agentTransport: AgentTransport = { connect: vi.fn(), execute, isConnected: () => true };

    const relayResult = await createSnowRelayTransport(agentTransport).execute(buildRelayRequest({ id: 'req-9', method: 'post', body: { a: 1 } }));

    expect(execute).toHaveBeenCalledWith({ method: 'POST', path: '/api/now/table/change_request', body: '{"a":1}' });
    expect(relayResult).toEqual({ id: 'req-9', ok: true, status: 201, data: '{"result":{}}', error: null });
  });
});
