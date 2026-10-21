// installRuntime.test.ts — Proves the pieces the loader bookmark runs: a release file is read (and any other file
// refused), the installed Wizard is kept and read back, and its page is assembled without touching the Wizard's code.

import { describe, expect, it } from 'vitest';

import {
  assembleWizardHtml,
  parseInstallFile,
  readInstalledWizard,
  writeInstalledWizard,
  type InstallStoreConfig,
  type InstalledWizard,
} from './installRuntime.ts';

const STORE_CONFIG: InstallStoreConfig = {
  databaseName: 'testDb',
  storeName: 'installedApp',
  recordKey: 'current',
  payloadElementId: 'snow-wizard-install',
  payloadKind: 'snowWizardInstall',
  appPlaceholder: '__APP__',
  stylePlaceholder: '__STYLE__',
  bootPlaceholder: '__BOOT__',
};

const INSTALLED: InstalledWizard = { version: 'v9.9.9', appSource: 'startWizard()', styleSource: 'p{color:red}' };

function buildReleaseFile(payload: object): string {
  return `<!doctype html><html><body><script type="application/json" id="snow-wizard-install">${JSON.stringify(payload)}</script><script>x()</script></body></html>`;
}

/** A minimal in-memory stand-in for the one IndexedDB store the Wizard uses. */
function createFakeStore(isWriteRefused = false) {
  const records = new Map<string, unknown>();
  const database = {
    transaction: () => {
      const writeTransaction: { oncomplete?: () => void; onerror?: () => void; error: Error | null; objectStore: () => unknown } = {
        error: isWriteRefused ? new Error('quota exceeded') : null,
        objectStore: () => ({
          get: (recordKey: string) => {
            const getRequest: { result?: unknown; onsuccess?: () => void } = {};
            queueMicrotask(() => {
              getRequest.result = records.get(recordKey);
              getRequest.onsuccess?.();
            });
            return getRequest;
          },
          put: (record: unknown, recordKey: string) => {
            queueMicrotask(() => {
              if (isWriteRefused) {
                writeTransaction.onerror?.();
                return;
              }
              records.set(recordKey, record);
              writeTransaction.oncomplete?.();
            });
          },
        }),
      };
      return writeTransaction;
    },
  };
  return { records, openStore: async () => database as unknown as IDBDatabase };
}

describe('parseInstallFile', () => {
  it('reads the Wizard out of a release file', () => {
    const fileText = buildReleaseFile({ kind: 'snowWizardInstall', ...INSTALLED });
    expect(parseInstallFile(fileText, STORE_CONFIG)).toEqual(INSTALLED);
  });

  it('refuses any other file: another kind, no block, broken JSON, or no code', () => {
    expect(parseInstallFile(buildReleaseFile({ kind: 'somethingElse', ...INSTALLED }), STORE_CONFIG)).toBeNull();
    expect(parseInstallFile('<html><body>hello</body></html>', STORE_CONFIG)).toBeNull();
    expect(parseInstallFile('<script type="application/json" id="snow-wizard-install">{nope</script>', STORE_CONFIG)).toBeNull();
    expect(parseInstallFile(buildReleaseFile({ kind: 'snowWizardInstall', version: 'v1', appSource: '', styleSource: '' }), STORE_CONFIG)).toBeNull();
  });
});

describe('assembleWizardHtml', () => {
  it('fills boot data, look and code — and never replaces the marks inside the Wizard’s own code', () => {
    const template = '<style>__STYLE__</style><script>boot=__BOOT__;</script><script>__APP__</script>';
    const codeNamingTheMarks = 'use("__BOOT__","__STYLE__","__APP__")';
    const pageHtml = assembleWizardHtml(template, { ...INSTALLED, appSource: codeNamingTheMarks }, '{"token":"t"}', STORE_CONFIG);
    expect(pageHtml).toBe('<style>p{color:red}</style><script>boot={"token":"t"};</script><script>use("__BOOT__","__STYLE__","__APP__")</script>');
  });
});

describe('readInstalledWizard / writeInstalledWizard', () => {
  it('keeps the installed Wizard and reads it back; reads null before anything is installed', async () => {
    const fakeStore = createFakeStore();
    expect(await readInstalledWizard(STORE_CONFIG, fakeStore.openStore)).toBeNull();
    await writeInstalledWizard(STORE_CONFIG, fakeStore.openStore, INSTALLED);
    expect(await readInstalledWizard(STORE_CONFIG, fakeStore.openStore)).toEqual(INSTALLED);
  });

  it('reads null when the storage cannot be opened, and rejects a write the browser refuses', async () => {
    expect(await readInstalledWizard(STORE_CONFIG, async () => { throw new Error('blocked'); })).toBeNull();
    await expect(writeInstalledWizard(STORE_CONFIG, createFakeStore(true).openStore, INSTALLED)).rejects.toThrow('quota exceeded');
  });
});
