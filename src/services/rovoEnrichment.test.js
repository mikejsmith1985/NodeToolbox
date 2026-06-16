// Unit tests for the shared non-blocking Rovo enrichment helper.

'use strict';

const { requestRovoText, isRovoEnabled } = require('./rovoEnrichment');

const ENABLED_CONFIG = { rovoAutomation: { isEnabled: true, webhookUrl: 'https://x.atlassian.net/hook' } };
const noopSleep = () => Promise.resolve();
const fixedCorrelationId = () => 'corr-1';

function baseDeps(overrides = {}) {
  return { sleep: noopSleep, generateCorrelationId: fixedCorrelationId, ...overrides };
}

describe('isRovoEnabled', () => {
  it('is false when disabled or unconfigured', () => {
    expect(isRovoEnabled({})).toBe(false);
    expect(isRovoEnabled({ rovoAutomation: { isEnabled: true } })).toBe(false); // no webhook
    expect(isRovoEnabled({ rovoAutomation: { isEnabled: false, webhookUrl: 'u' } })).toBe(false);
  });
  it('is true when enabled with a webhook', () => {
    expect(isRovoEnabled(ENABLED_CONFIG)).toBe(true);
  });
});

describe('requestRovoText', () => {
  it('returns null without dispatching when Rovo is disabled', async () => {
    const dispatchPrompt = jest.fn();
    const result = await requestRovoText({}, 'hello', {}, baseDeps({ dispatchPrompt }));
    expect(result).toBeNull();
    expect(dispatchPrompt).not.toHaveBeenCalled();
  });

  it('returns null for an empty prompt', async () => {
    expect(await requestRovoText(ENABLED_CONFIG, '   ', {}, baseDeps())).toBeNull();
  });

  it('dispatches then returns the response when the page is ready', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true, httpStatus: 200, code: 'dispatched' });
    const fetchResult = jest.fn().mockResolvedValue({ ok: true, ready: true, response: 'INSIGHT: ship it' });
    const result = await requestRovoText(ENABLED_CONFIG, 'summarise', {}, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBe('INSIGHT: ship it');
    expect(dispatchPrompt).toHaveBeenCalledWith(ENABLED_CONFIG, { correlationId: 'corr-1', prompt: 'summarise' });
  });

  it('returns null when dispatch fails', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: false, code: 'host-not-allowed' });
    const fetchResult = jest.fn();
    expect(await requestRovoText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }))).toBeNull();
    expect(fetchResult).not.toHaveBeenCalled();
  });

  it('polls until ready, then returns the response', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn()
      .mockResolvedValueOnce({ ok: true, ready: false })
      .mockResolvedValueOnce({ ok: true, ready: false })
      .mockResolvedValueOnce({ ok: true, ready: true, response: 'late answer' });
    const result = await requestRovoText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBe('late answer');
    expect(fetchResult).toHaveBeenCalledTimes(3);
  });

  it('returns null (non-blocking) after the poll budget is exhausted', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn().mockResolvedValue({ ok: true, ready: false });
    const result = await requestRovoText(ENABLED_CONFIG, 'x', { pollAttempts: 3 }, baseDeps({ dispatchPrompt, fetchResult }));
    expect(result).toBeNull();
    expect(fetchResult).toHaveBeenCalledTimes(3);
  });

  it('stops polling and returns null on a hard result error', async () => {
    const dispatchPrompt = jest.fn().mockResolvedValue({ ok: true });
    const fetchResult = jest.fn().mockResolvedValue({ ok: false, code: 'fetch-failed' });
    expect(await requestRovoText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt, fetchResult }))).toBeNull();
    expect(fetchResult).toHaveBeenCalledTimes(1);
  });

  it('never throws — a thrown dispatch becomes null', async () => {
    const dispatchPrompt = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await requestRovoText(ENABLED_CONFIG, 'x', {}, baseDeps({ dispatchPrompt }))).toBeNull();
  });
});
