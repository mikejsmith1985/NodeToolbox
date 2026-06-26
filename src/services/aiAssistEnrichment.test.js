// Unit tests for the shared non-blocking AI Assist enrichment helper.

'use strict';

const { requestAiAssistText, isAiAssistEnabled } = require('./aiAssistEnrichment');

const ENABLED_CONFIG = { aiAssistAutomation: { isEnabled: true, webhookUrl: 'https://x.atlassian.net/hook' } };
const noopSleep = () => Promise.resolve();
const fixedCorrelationId = () => 'corr-1';

function baseDeps(overrides = {}) {
  return { sleep: noopSleep, generateCorrelationId: fixedCorrelationId, ...overrides };
}

describe('isAiAssistEnabled', () => {
  it('is false when disabled or unconfigured', () => {
    expect(isAiAssistEnabled({})).toBe(false);
    expect(isAiAssistEnabled({ aiAssistAutomation: { isEnabled: true } })).toBe(false); // no webhook
    expect(isAiAssistEnabled({ aiAssistAutomation: { isEnabled: false, webhookUrl: 'u' } })).toBe(false);
  });
  it('is true when enabled with a webhook', () => {
    expect(isAiAssistEnabled(ENABLED_CONFIG)).toBe(true);
  });
});

describe('requestAiAssistText', () => {
  it('returns null without dispatching when AI Assist is disabled', async () => {
    const dispatchPrompt = jest.fn();
    const result = await requestAiAssistText({}, 'hello', {}, baseDeps({ dispatchPrompt }));
    expect(result).toBeNull();
    expect(dispatchPrompt).not.toHaveBeenCalled();
  });

  it('returns null for an empty prompt', async () => {
    expect(await requestAiAssistText(ENABLED_CONFIG, '   ', {}, baseDeps())).toBeNull();
  });

  it('dispatches then returns the response when the page is ready', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true, httpStatus: 200, code: 'dispatched' });
    const fetchResult = jest.fn().mockResolvedValue({ ok: true, ready: true, response: 'INSIGHT: ship it' });
    const result = await requestAiAssistText(ENABLED_CONFIG, 'summarise', {}, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBe('INSIGHT: ship it');
    expect(dispatchPrompt).toHaveBeenCalledWith(ENABLED_CONFIG, { correlationId: 'corr-1', prompt: 'summarise' });
  });

  it('returns null when dispatch fails', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: false, code: 'host-not-allowed' });
    const fetchResult = jest.fn();
    expect(await requestAiAssistText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }))).toBeNull();
    expect(fetchResult).not.toHaveBeenCalled();
  });

  it('polls until ready, then returns the response', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn()
      .mockResolvedValueOnce({ ok: true, ready: false })
      .mockResolvedValueOnce({ ok: true, ready: false })
      .mockResolvedValueOnce({ ok: true, ready: true, response: 'late answer' });
    const result = await requestAiAssistText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBe('late answer');
    expect(fetchResult).toHaveBeenCalledTimes(3);
  });

  it('returns null (non-blocking) after the poll budget is exhausted', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn().mockResolvedValue({ ok: true, ready: false });
    const result = await requestAiAssistText(ENABLED_CONFIG, 'x', { pollAttempts: 3 }, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBeNull();
    expect(fetchResult).toHaveBeenCalledTimes(3);
  });

  it('caps the DEFAULT poll budget so a dead backend cannot stall a report (~6s, 3 attempts)', async () => {
    // Safety net: with Rovo off the parking page never fills, so the default budget must
    // stay small. A never-ready backend should be abandoned after the default attempts.
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn().mockResolvedValue({ ok: true, ready: false });
    const result = await requestAiAssistText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBeNull();
    expect(fetchResult).toHaveBeenCalledTimes(3);
  });

  it('stops polling and returns null on a hard result error', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn().mockResolvedValue({ ok: false, code: 'fetch-failed' });
    expect(await requestAiAssistText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }))).toBeNull();
    expect(fetchResult).toHaveBeenCalledTimes(1);
  });

  it('never throws — a thrown dispatch becomes null', async () => {
    const dispatchPrompt = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await requestAiAssistText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt }))).toBeNull();
  });
});
