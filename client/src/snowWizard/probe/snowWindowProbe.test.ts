// snowWindowProbe.test.ts — Proves the probe window opened inside ServiceNow runs its checks and reports them in one block.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCRIPT_BLOCKED_NOTICE_ID } from './probeAssets.ts';
import { mountSnowWindowProbe, type SnowWindowProbeDependencies } from './snowWindowProbe.ts';

const BOOT = {
  instanceOrigin: 'https://acme.service-now.com',
  userToken: 'token-1',
  channelName: 'snowWizardProbe',
  jiraUrl: 'https://jira.example.com',
};

function createDependencies(): SnowWindowProbeDependencies {
  return {
    fetchFn: vi.fn(async (url: string) => (url.includes('sys_user')
      ? new Response(JSON.stringify({ result: [{ name: 'Jane Smith' }] }), { status: 200 })
      : new Response(JSON.stringify({ result: [{ number: 'CHG0001' }] }), { status: 200 }))),
    createChannel: () => ({ postMessage: vi.fn(), addEventListener: vi.fn(), close: vi.fn() }),
    openWindow: vi.fn(() => null),
    pickFiles: undefined,
    handleStore: { save: vi.fn(), load: vi.fn(async () => null) },
    userAgent: 'Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36',
    broadcastTimeoutMs: 10,
    helloTimeoutMs: 1000,
  };
}

describe('mountSnowWindowProbe', () => {
  let probeRoot: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<p id="${SCRIPT_BLOCKED_NOTICE_ID}">blocked</p><main></main>`;
    probeRoot = document.querySelector('main') as HTMLElement;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function readResultBlock(): string {
    return (probeRoot.querySelector('[data-probe-result]') as HTMLTextAreaElement).value;
  }

  it('removes the "script was blocked" notice, proving this window can run code', () => {
    mountSnowWindowProbe(probeRoot, BOOT, createDependencies());
    expect(document.getElementById(SCRIPT_BLOCKED_NOTICE_ID)).toBeNull();
  });

  it('runs the ServiceNow probes on open and reports them in the snow-window block', async () => {
    mountSnowWindowProbe(probeRoot, BOOT, createDependencies());

    await vi.waitFor(() => {
      expect(readResultBlock()).toContain('PROBE v1 | snow-window | Chrome 141');
      expect(readResultBlock()).toContain('P-SNOW-BLOB=pass(signed in as Jane Smith)');
      expect(readResultBlock()).toContain('P-SNOW-WRITE-SAFE=pass(');
      expect(readResultBlock()).toContain('P-SNOW-BROADCAST=fail(no answer within');
    });
  });

  it('never shows the session token on the page', async () => {
    mountSnowWindowProbe(probeRoot, BOOT, createDependencies());
    await vi.waitFor(() => expect(readResultBlock()).toContain('P-SNOW-BLOB=pass'));
    expect(document.body.innerHTML).not.toContain('token-1');
  });

  it('opens Jira from this window when asked', () => {
    const dependencies = createDependencies();
    mountSnowWindowProbe(probeRoot, BOOT, dependencies);
    const openJiraButton = Array.from(probeRoot.querySelectorAll('button')).find((buttonElement) => buttonElement.textContent?.includes('Open Jira'));
    openJiraButton?.click();
    expect(dependencies.openWindow).toHaveBeenCalledWith('https://jira.example.com', 'snowWizardProbeJiraFromSnow');
  });
});
