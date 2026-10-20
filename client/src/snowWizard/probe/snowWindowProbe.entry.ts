// snowWindowProbe.entry.ts — Script of the probe window opened inside ServiceNow; wires real browser APIs into the probe.

import { createIndexedDbHandleStore, type FilePicker } from './snowProbes.ts';
import { mountSnowWindowProbe, type SnowWindowBoot } from './snowWindowProbe.ts';

const BROADCAST_TIMEOUT_MS = 3 * 1000;
const HELLO_TIMEOUT_MS = 3 * 60 * 1000;

function readBoot(): SnowWindowBoot | null {
  const bootCandidate = (window as Window & { __SNOW_WIZARD_BOOT__?: unknown }).__SNOW_WIZARD_BOOT__;
  if (!bootCandidate || typeof bootCandidate !== 'object') return null;
  return bootCandidate as SnowWindowBoot;
}

function resolveMountRoot(): HTMLElement {
  const existingRoot = document.querySelector('main');
  if (existingRoot) return existingRoot;
  const createdRoot = document.createElement('main');
  document.body.appendChild(createdRoot);
  return createdRoot;
}

const windowBoot = readBoot();
if (windowBoot) {
  const filePicker = (window as Window & { showOpenFilePicker?: FilePicker }).showOpenFilePicker;
  mountSnowWindowProbe(resolveMountRoot(), windowBoot, {
    fetchFn: (input, init) => fetch(input, init),
    createChannel: (channelName) => new BroadcastChannel(channelName),
    openWindow: (url, windowName) => window.open(url, windowName),
    pickFiles: filePicker ? () => filePicker.call(window) : undefined,
    handleStore: createIndexedDbHandleStore(),
    userAgent: navigator.userAgent,
    broadcastTimeoutMs: BROADCAST_TIMEOUT_MS,
    helloTimeoutMs: HELLO_TIMEOUT_MS,
  });
} else {
  resolveMountRoot().textContent = 'Open this window by clicking the probe bookmark on your ServiceNow tab.';
}
