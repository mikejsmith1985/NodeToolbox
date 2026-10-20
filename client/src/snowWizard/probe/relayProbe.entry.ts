// relayProbe.entry.ts — Script of the probe file itself (opened from disk); wires real browser APIs into the guided page.

import { DEFAULT_HELLO_TIMEOUT_MS, mountFilePageProbe } from './filePageProbe.ts';
import { readProbeBuildInputs } from './probeAssets.ts';

const probeRoot = document.createElement('main');
probeRoot.className = 'probe-page';
document.body.appendChild(probeRoot);

mountFilePageProbe(probeRoot, {
  assets: readProbeBuildInputs(),
  openWindow: (url, windowName) => window.open(url, windowName),
  userAgent: navigator.userAgent,
  helloTimeoutMs: DEFAULT_HELLO_TIMEOUT_MS,
});
