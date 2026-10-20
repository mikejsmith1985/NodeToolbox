// filePageProbe.test.ts — Proves the probe file's own page guides the owner and records only what it actually observed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BIG_BOOKMARK_BUDGET_BYTES, mountFilePageProbe, type FilePageProbeDependencies } from './filePageProbe.ts';

const CHANNEL_NAME = 'snowWizardProbe';

function createDependencies(): FilePageProbeDependencies & { openWindow: ReturnType<typeof vi.fn> } {
  return {
    assets: { snowWindowAppSource: 'void 0', probeStyleSource: '' },
    openWindow: vi.fn(() => null),
    userAgent: 'Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36',
    helloTimeoutMs: 1000,
  };
}

function typeInto(root: HTMLElement, label: string, value: string): void {
  const inputField = Array.from(root.querySelectorAll('label')).find((labelElement) => labelElement.textContent?.includes(label))
    ?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement;
  inputField.value = value;
  inputField.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickButton(root: HTMLElement, buttonText: string): void {
  const matchingButton = Array.from(root.querySelectorAll('button')).find((buttonElement) => buttonElement.textContent?.includes(buttonText));
  (matchingButton as HTMLButtonElement).click();
}

function readResultBlock(root: HTMLElement): string {
  return (root.querySelector('[data-probe-result]') as HTMLTextAreaElement).value;
}

describe('mountFilePageProbe', () => {
  let probeRoot: HTMLElement;

  beforeEach(() => {
    probeRoot = document.createElement('main');
    document.body.appendChild(probeRoot);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts with every file-page probe reported as not run', () => {
    mountFilePageProbe(probeRoot, createDependencies());
    expect(readResultBlock(probeRoot)).toContain('PROBE v1 | file-page | Chrome 141');
    expect(readResultBlock(probeRoot)).toContain('P-JIRA-OPENER-FROM-FILE=fail(not run)');
  });

  it('offers the draggable probe bookmark only once the Jira address is known', () => {
    mountFilePageProbe(probeRoot, createDependencies());
    expect(probeRoot.querySelector('a[data-probe-bookmark]')).toBeNull();

    typeInto(probeRoot, 'Jira address', 'https://jira.example.com');

    const bookmarkLink = probeRoot.querySelector('a[data-probe-bookmark]') as HTMLAnchorElement;
    expect(bookmarkLink.getAttribute('href')?.startsWith('javascript:')).toBe(true);
  });

  it('offers a big bookmark padded to the size budget', () => {
    mountFilePageProbe(probeRoot, createDependencies());
    typeInto(probeRoot, 'Jira address', 'https://jira.example.com');
    const bigBookmark = probeRoot.querySelector('a[data-big-bookmark]') as HTMLAnchorElement;
    expect(bigBookmark.getAttribute('href')?.length).toBeGreaterThanOrEqual(BIG_BOOKMARK_BUDGET_BYTES);
  });

  it('records the pasted headers as P-HEADERS', () => {
    mountFilePageProbe(probeRoot, createDependencies());
    typeInto(probeRoot, 'ServiceNow headers', 'cross-origin-opener-policy: same-origin');
    typeInto(probeRoot, 'Jira headers', 'x-frame-options: SAMEORIGIN');
    expect(readResultBlock(probeRoot)).toContain('P-HEADERS=pass(SNow: cross-origin-opener-policy: same-origin; Jira: x-frame-options: SAMEORIGIN)');
  });

  it('passes P-JIRA-OPENER-FROM-FILE only after the Jira agent says hello and answers', async () => {
    const dependencies = createDependencies();
    mountFilePageProbe(probeRoot, dependencies);
    typeInto(probeRoot, 'Jira address', 'https://jira.example.com');

    clickButton(probeRoot, 'Open Jira from this page');
    expect(dependencies.openWindow).toHaveBeenCalledWith('https://jira.example.com', 'snowWizardProbeJiraFromFile');

    const agentWindow = { postMessage: vi.fn((message: { requestId: string }) => {
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        data: { channel: CHANNEL_NAME, kind: 'response', requestId: message.requestId, status: 200, body: '{"displayName":"Smith, Jane"}' },
      })));
    }) };
    window.dispatchEvent(new MessageEvent('message', { data: { channel: CHANNEL_NAME, kind: 'hello', system: 'jira' }, origin: 'https://jira.example.com', source: agentWindow as unknown as MessageEventSource }));

    await vi.waitFor(() => expect(readResultBlock(probeRoot)).toContain('P-JIRA-OPENER-FROM-FILE=pass(Jira answered as Smith, Jane)'));
  });

  it('records the owner\'s report of the big bookmark', () => {
    mountFilePageProbe(probeRoot, createDependencies());
    clickButton(probeRoot, 'It showed the green badge');
    expect(readResultBlock(probeRoot)).toContain('P-BOOKMARK-SIZE=pass(');
  });
});
