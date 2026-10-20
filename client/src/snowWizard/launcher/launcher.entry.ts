// launcher.entry.ts — Script of the shared snow-hub-wizard.html file: mounts the installer page.

import { mountLauncherPage, readLauncherBuildInputs } from './launcherPage.ts';

const launcherRoot = document.createElement('main');
launcherRoot.className = 'probe-page';
document.body.appendChild(launcherRoot);

mountLauncherPage(launcherRoot, {
  assets: readLauncherBuildInputs(),
  openWindow: (url, windowName) => { window.open(url, windowName); },
});
