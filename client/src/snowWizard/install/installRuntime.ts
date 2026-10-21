// installRuntime.ts — The pieces of the Wizard install that run INSIDE the bookmark on ServiceNow's page: open the
// ServiceNow-origin store, read and write the installed Wizard, read it out of a release file, and assemble its page.
//
// IMPORTANT: every function here is serialized with `.toString()` into the bookmark. Each uses nothing but its
// arguments and browser globals — no imports, no module-level values (wizardInstall.ts holds the data they are given).

/** Where the installed Wizard lives and how the release file marks it — handed to the bookmark as data. */
export interface InstallStoreConfig {
  databaseName: string;
  storeName: string;
  recordKey: string;
  /** The id of the JSON block inside the release file (scripts/build-snow-wizard.js writes it). */
  payloadElementId: string;
  /** The block's `kind`, so any other file is refused. */
  payloadKind: string;
  /** Marks in the window template where the Wizard's code and look go. */
  appPlaceholder: string;
  stylePlaceholder: string;
  bootPlaceholder: string;
}

/** The installed Wizard: its version, code and look. */
export interface InstalledWizard {
  version: string;
  appSource: string;
  styleSource: string;
}

/** Opens (creating on first use) the ServiceNow-origin database the Wizard is kept in. */
export function openInstallStore(storeConfig: InstallStoreConfig): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(storeConfig.databaseName, 1);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(storeConfig.storeName);
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

/** The installed Wizard, or null when none is installed (or the storage cannot be read). */
export async function readInstalledWizard(
  storeConfig: InstallStoreConfig,
  openStore: (storeConfig: InstallStoreConfig) => Promise<IDBDatabase>,
): Promise<InstalledWizard | null> {
  try {
    const database = await openStore(storeConfig);
    return await new Promise((resolve) => {
      const getRequest = database.transaction(storeConfig.storeName, 'readonly').objectStore(storeConfig.storeName).get(storeConfig.recordKey);
      getRequest.onsuccess = () => resolve((getRequest.result as InstalledWizard | undefined) ?? null);
      getRequest.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Stores a Wizard as the installed one, replacing any older version. */
export async function writeInstalledWizard(
  storeConfig: InstallStoreConfig,
  openStore: (storeConfig: InstallStoreConfig) => Promise<IDBDatabase>,
  installedWizard: InstalledWizard,
): Promise<void> {
  const database = await openStore(storeConfig);
  await new Promise<void>((resolve, reject) => {
    const writeTransaction = database.transaction(storeConfig.storeName, 'readwrite');
    writeTransaction.objectStore(storeConfig.storeName).put(installedWizard, storeConfig.recordKey);
    writeTransaction.oncomplete = () => resolve();
    writeTransaction.onerror = () => reject(writeTransaction.error);
  });
}

/** Reads the Wizard out of a release file's text, or null when the file is not the SNow Wizard. */
export function parseInstallFile(fileText: string, storeConfig: InstallStoreConfig): InstalledWizard | null {
  try {
    const payloadElement = new DOMParser().parseFromString(fileText, 'text/html').getElementById(storeConfig.payloadElementId);
    const payload = JSON.parse(payloadElement?.textContent ?? '') as Partial<InstalledWizard> & { kind?: string };
    if (payload.kind !== storeConfig.payloadKind) return null;
    if (typeof payload.appSource !== 'string' || payload.appSource === '' || typeof payload.styleSource !== 'string') return null;
    return { version: String(payload.version ?? ''), appSource: payload.appSource, styleSource: payload.styleSource };
  } catch {
    return null;
  }
}

/**
 * The Wizard window's page: boot data first, then the look, then the code LAST — so nothing inside the Wizard's own
 * code (which names these marks) is ever replaced.
 */
export function assembleWizardHtml(windowTemplate: string, installedWizard: InstalledWizard, bootJson: string, storeConfig: InstallStoreConfig): string {
  return windowTemplate
    .split(storeConfig.bootPlaceholder).join(bootJson)
    .split(storeConfig.stylePlaceholder).join(installedWizard.styleSource)
    .split(storeConfig.appPlaceholder).join(installedWizard.appSource);
}

/** Boot data as JSON that can never close the page's <script> element early (every "<" becomes its JSON escape). */
export function encodeBootJson(bootData: object): string {
  return JSON.stringify(bootData).split('<').join(`${String.fromCharCode(92)}u003c`);
}
