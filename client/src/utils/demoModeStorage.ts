// demoModeStorage.ts — Session-scoped storage isolation for first-install demos.

import { isPersistentSettingsStorageKey } from './persistentSettingsStorage.ts';

const DEMO_MODE_QUERY_PARAMETER = 'demo';
const DEMO_MODE_QUERY_VALUE = '1';
const DEMO_MODE_SESSION_FLAG_KEY = 'ntbx-demo-mode-enabled';
const DEMO_LOCAL_STORAGE_PREFIX = 'ntbx-demo-local-storage:';
const APP_STORAGE_PREFIXES = ['tbx', 'ntbx-', 'toolbox-', 'nodetoolbox-'];
const DEMO_MODE_REQUEST_HEADER = 'X-NodeToolbox-Demo-Mode';

interface DemoStorageOriginalMethods {
  getItem: Storage['getItem'];
  setItem: Storage['setItem'];
  removeItem: Storage['removeItem'];
  clear: Storage['clear'];
  key: Storage['key'];
  lengthDescriptor?: PropertyDescriptor;
}

interface DemoStorageWindow extends Window {
  __nodeToolboxDemoStorageOriginals?: DemoStorageOriginalMethods;
  __nodeToolboxDemoStorageIsPatched?: boolean;
  __nodeToolboxDemoFetchOriginal?: typeof fetch;
  __nodeToolboxDemoFetchIsPatched?: boolean;
  __nodeToolboxDemoFetchPatched?: typeof fetch;
}

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined'
    && typeof window.localStorage !== 'undefined'
    && typeof window.sessionStorage !== 'undefined'
    && typeof Storage !== 'undefined';
}

function canUseBrowserFetch(): boolean {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

function readOriginalMethods(): DemoStorageOriginalMethods {
  const demoStorageWindow = window as DemoStorageWindow;
  if (demoStorageWindow.__nodeToolboxDemoStorageOriginals) {
    return demoStorageWindow.__nodeToolboxDemoStorageOriginals;
  }

  const originalMethods: DemoStorageOriginalMethods = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key,
    lengthDescriptor: Object.getOwnPropertyDescriptor(Storage.prototype, 'length'),
  };
  demoStorageWindow.__nodeToolboxDemoStorageOriginals = originalMethods;
  return originalMethods;
}

function createDemoStorageKey(storageKey: string): string {
  return `${DEMO_LOCAL_STORAGE_PREFIX}${storageKey}`;
}

function isLocalStorageReceiver(storageTarget: Storage): boolean {
  return canUseBrowserStorage() && storageTarget === window.localStorage;
}

function isDemoModeStorageKey(storageKey: string): boolean {
  return (
    isPersistentSettingsStorageKey(storageKey)
    || APP_STORAGE_PREFIXES.some((storagePrefix) => storageKey.startsWith(storagePrefix))
  );
}

function readSessionStorageValue(storageKey: string): string | null {
  const originalMethods = readOriginalMethods();
  return originalMethods.getItem.call(window.sessionStorage, storageKey);
}

function writeSessionStorageValue(storageKey: string, storageValue: string): void {
  const originalMethods = readOriginalMethods();
  originalMethods.setItem.call(window.sessionStorage, storageKey, storageValue);
}

function removeSessionStorageValue(storageKey: string): void {
  const originalMethods = readOriginalMethods();
  originalMethods.removeItem.call(window.sessionStorage, storageKey);
}

function readDemoStorageKeys(): string[] {
  const originalMethods = readOriginalMethods();
  const demoStorageKeys: string[] = [];
  for (let storageIndex = 0; storageIndex < window.sessionStorage.length; storageIndex += 1) {
    const sessionStorageKey = originalMethods.key.call(window.sessionStorage, storageIndex);
    if (sessionStorageKey?.startsWith(DEMO_LOCAL_STORAGE_PREFIX)) {
      demoStorageKeys.push(sessionStorageKey.slice(DEMO_LOCAL_STORAGE_PREFIX.length));
    }
  }
  return demoStorageKeys;
}

function clearDemoStorageValues(): void {
  const originalMethods = readOriginalMethods();
  const namespacedKeysToRemove: string[] = [];
  for (let storageIndex = 0; storageIndex < window.sessionStorage.length; storageIndex += 1) {
    const sessionStorageKey = originalMethods.key.call(window.sessionStorage, storageIndex);
    if (sessionStorageKey?.startsWith(DEMO_LOCAL_STORAGE_PREFIX)) {
      namespacedKeysToRemove.push(sessionStorageKey);
    }
  }

  for (const namespacedKey of namespacedKeysToRemove) {
    originalMethods.removeItem.call(window.sessionStorage, namespacedKey);
  }
}

function activateDemoModeFromUrl(): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get(DEMO_MODE_QUERY_PARAMETER) !== DEMO_MODE_QUERY_VALUE) {
    return;
  }

  writeSessionStorageValue(DEMO_MODE_SESSION_FLAG_KEY, DEMO_MODE_QUERY_VALUE);
  currentUrl.searchParams.delete(DEMO_MODE_QUERY_PARAMETER);
  window.history.replaceState(window.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
}

function patchLocalStorageForDemoMode(): void {
  const demoStorageWindow = window as DemoStorageWindow;
  if (demoStorageWindow.__nodeToolboxDemoStorageIsPatched) {
    return;
  }

  const originalMethods = readOriginalMethods();
  demoStorageWindow.__nodeToolboxDemoStorageIsPatched = true;
  Storage.prototype.getItem = function getDemoAwareItem(storageKey: string): string | null {
    if (isLocalStorageReceiver(this) && isDemoModeEnabled() && isDemoModeStorageKey(storageKey)) {
      return readSessionStorageValue(createDemoStorageKey(storageKey));
    }
    return originalMethods.getItem.call(this, storageKey);
  };

  Storage.prototype.setItem = function setDemoAwareItem(storageKey: string, storageValue: string): void {
    if (isLocalStorageReceiver(this) && isDemoModeEnabled() && isDemoModeStorageKey(storageKey)) {
      writeSessionStorageValue(createDemoStorageKey(storageKey), storageValue);
      return;
    }
    originalMethods.setItem.call(this, storageKey, storageValue);
  };

  Storage.prototype.removeItem = function removeDemoAwareItem(storageKey: string): void {
    if (isLocalStorageReceiver(this) && isDemoModeEnabled() && isDemoModeStorageKey(storageKey)) {
      removeSessionStorageValue(createDemoStorageKey(storageKey));
      return;
    }
    originalMethods.removeItem.call(this, storageKey);
  };

  Storage.prototype.clear = function clearDemoAwareStorage(): void {
    if (isLocalStorageReceiver(this) && isDemoModeEnabled()) {
      clearDemoStorageValues();
      return;
    }
    originalMethods.clear.call(this);
  };

  Storage.prototype.key = function readDemoAwareStorageKey(storageIndex: number): string | null {
    if (isLocalStorageReceiver(this) && isDemoModeEnabled()) {
      return readDemoStorageKeys()[storageIndex] ?? null;
    }
    return originalMethods.key.call(this, storageIndex);
  };

  if (originalMethods.lengthDescriptor?.get) {
    Object.defineProperty(Storage.prototype, 'length', {
      configurable: true,
      get() {
        if (isLocalStorageReceiver(this) && isDemoModeEnabled()) {
          return readDemoStorageKeys().length;
        }
        return originalMethods.lengthDescriptor?.get?.call(this) ?? 0;
      },
    });
  }
}

function isSameOriginRequest(fetchInput: RequestInfo | URL): boolean {
  const requestUrl = fetchInput instanceof Request ? fetchInput.url : fetchInput.toString();
  const resolvedUrl = new URL(requestUrl, window.location.href);
  return resolvedUrl.origin === window.location.origin;
}

function addDemoModeHeader(fetchInput: RequestInfo | URL, fetchInit?: RequestInit): RequestInit {
  const requestHeaders = fetchInput instanceof Request ? fetchInput.headers : undefined;
  const updatedHeaders = new Headers(fetchInit?.headers ?? requestHeaders);
  updatedHeaders.set(DEMO_MODE_REQUEST_HEADER, '1');
  return { ...fetchInit, headers: updatedHeaders };
}

function patchFetchForDemoMode(): void {
  if (!canUseBrowserFetch()) {
    return;
  }

  const demoStorageWindow = window as DemoStorageWindow;
  if (
    demoStorageWindow.__nodeToolboxDemoFetchIsPatched
    && window.fetch === demoStorageWindow.__nodeToolboxDemoFetchPatched
  ) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  demoStorageWindow.__nodeToolboxDemoFetchOriginal = originalFetch;
  demoStorageWindow.__nodeToolboxDemoFetchIsPatched = true;

  const demoAwareFetch = function fetchWithDemoModeHeader(fetchInput: RequestInfo | URL, fetchInit?: RequestInit) {
    if (isDemoModeEnabled() && isSameOriginRequest(fetchInput)) {
      return originalFetch(fetchInput, addDemoModeHeader(fetchInput, fetchInit));
    }
    return originalFetch(fetchInput, fetchInit);
  };

  demoStorageWindow.__nodeToolboxDemoFetchPatched = demoAwareFetch;
  window.fetch = demoAwareFetch;
}

/** Installs demo-mode storage isolation before the React app reads persisted settings. */
export function initializeDemoModeStorageIsolation(): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  activateDemoModeFromUrl();
  patchLocalStorageForDemoMode();
  patchFetchForDemoMode();
}

/** Returns true when the current tab is using session-scoped first-install demo settings. */
export function isDemoModeEnabled(): boolean {
  if (!canUseBrowserStorage()) {
    return false;
  }

  return readSessionStorageValue(DEMO_MODE_SESSION_FLAG_KEY) === DEMO_MODE_QUERY_VALUE;
}

/** Builds a URL that opens this app in first-install demo mode without changing the current tab. */
export function createDemoModeUrl(currentUrlValue: string): string {
  const demoModeUrl = new URL(currentUrlValue);
  demoModeUrl.searchParams.set(DEMO_MODE_QUERY_PARAMETER, DEMO_MODE_QUERY_VALUE);
  return demoModeUrl.toString();
}

/** Leaves demo mode for the current tab and discards only the session-scoped demo settings. */
export function disableDemoModeForCurrentTab(): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  clearDemoStorageValues();
  removeSessionStorageValue(DEMO_MODE_SESSION_FLAG_KEY);
}

initializeDemoModeStorageIsolation();
