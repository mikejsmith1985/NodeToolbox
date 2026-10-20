// snowProbes.ts — The checks the probe runs from inside ServiceNow's origin: identity, a read, token refresh, and file memory.

import type { ProbeOutcome } from './probeResult.ts';

/** Asks ServiceNow who is signed in — a harmless read that needs the session to work. */
export const SNOW_IDENTITY_PATH =
  '/api/now/table/sys_user?sysparm_query=user_name=javascript:gs.getUserName()&sysparm_fields=name&sysparm_limit=1';
/** Reads one change number — proves the change table (what the Wizard writes to) accepts this window's calls. */
export const SNOW_CHANGE_READ_PATH = '/api/now/table/change_request?sysparm_fields=number&sysparm_limit=1';

const MILLISECONDS_PER_SECOND = 1000;

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

function buildSnowReadInit(userToken: string): RequestInit {
  const requestHeaders: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  if (userToken) requestHeaders['X-UserToken'] = userToken;
  return { method: 'GET', credentials: 'include', headers: requestHeaders };
}

async function readSnowJson(fetchFn: FetchFunction, url: string, userToken: string): Promise<{ status: number; body: { result?: Array<Record<string, string>> } | null }> {
  const snowResponse = await fetchFn(url, buildSnowReadInit(userToken));
  if (!snowResponse.ok) return { status: snowResponse.status, body: null };
  return { status: snowResponse.status, body: await snowResponse.json() };
}

function describeError(caughtError: unknown): string {
  return caughtError instanceof Error ? caughtError.message : String(caughtError);
}

/** P-SNOW-BLOB: passes only when ServiceNow returns the signed-in user to a same-origin call from this window. */
export async function runSnowIdentityProbe(fetchFn: FetchFunction, instanceOrigin: string, userToken: string): Promise<ProbeOutcome> {
  try {
    const { status, body } = await readSnowJson(fetchFn, instanceOrigin + SNOW_IDENTITY_PATH, userToken);
    if (!body) return { isPassed: false, detail: `HTTP ${status}` };
    const signedInName = body.result?.[0]?.name;
    return signedInName
      ? { isPassed: true, detail: `signed in as ${signedInName}` }
      : { isPassed: false, detail: `HTTP ${status} but no user returned` };
  } catch (caughtError) {
    return { isPassed: false, detail: describeError(caughtError) };
  }
}

/** P-SNOW-WRITE-SAFE: a read of the change table, the stand-in for write access the probe must never exercise. */
export async function runSnowReadProbe(fetchFn: FetchFunction, instanceOrigin: string, userToken: string): Promise<ProbeOutcome> {
  try {
    const { status, body } = await readSnowJson(fetchFn, instanceOrigin + SNOW_CHANGE_READ_PATH, userToken);
    return body ? { isPassed: true, detail: `change table readable (HTTP ${status})` } : { isPassed: false, detail: `HTTP ${status}` };
  } catch (caughtError) {
    return { isPassed: false, detail: describeError(caughtError) };
  }
}

/** The part of a BroadcastChannel the token probe uses. */
export interface TokenChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (messageEvent: MessageEvent) => void): void;
  close(): void;
}

/**
 * P-SNOW-BROADCAST: asks the ServiceNow tab for a fresh session token over a same-origin channel — how the Wizard will
 * recover when the token it was opened with expires. The token is compared, never shown.
 */
export function runSnowBroadcastProbe(
  createChannel: (channelName: string) => TokenChannel,
  channelName: string,
  expectedToken: string,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const tokenChannel = createChannel(channelName);
  return new Promise((resolve) => {
    const finish = (outcome: ProbeOutcome) => {
      clearTimeout(timeoutId);
      tokenChannel.close();
      resolve(outcome);
    };
    const timeoutId = setTimeout(() => finish({ isPassed: false, detail: `no answer within ${Math.round(timeoutMs / MILLISECONDS_PER_SECOND)}s` }), timeoutMs);
    tokenChannel.addEventListener('message', (messageEvent: MessageEvent) => {
      if (!messageEvent.data || messageEvent.data.kind !== 'token') return;
      const receivedToken = String(messageEvent.data.token ?? '');
      if (!receivedToken) return finish({ isPassed: false, detail: 'answer carried no token' });
      const detail = receivedToken === expectedToken ? 'token received from the ServiceNow tab' : 'token received (it had changed)';
      finish({ isPassed: true, detail });
    });
    tokenChannel.postMessage({ kind: 'tokenRequest' });
  });
}

// ── P-FILE-HANDLE: can ServiceNow's origin remember the Wizard file so one click reopens it? ──

/** The part of a FileSystemFileHandle the probe uses. */
export interface ProbeFileHandle {
  getFile(): Promise<File>;
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

/** Where a picked file handle is remembered between visits. */
export interface FileHandleStore {
  save(fileHandle: ProbeFileHandle): Promise<void>;
  load(): Promise<ProbeFileHandle | null>;
}

export type FilePicker = () => Promise<ProbeFileHandle[]>;

/** Lets the owner pick any file and remembers it; fails plainly when the browser has no file picker. */
export async function pickAndRememberFile(pickFiles: FilePicker | undefined, handleStore: FileHandleStore): Promise<ProbeOutcome> {
  if (!pickFiles) return { isPassed: false, detail: 'this browser has no file picker (showOpenFilePicker)' };
  try {
    const [pickedHandle] = await pickFiles();
    const pickedFile = await pickedHandle.getFile();
    await handleStore.save(pickedHandle);
    return { isPassed: true, detail: `picked ${pickedFile.name} (${pickedFile.size} bytes)` };
  } catch (caughtError) {
    return { isPassed: false, detail: describeError(caughtError) };
  }
}

/** Reads the remembered file again — the "one click next time" the fallback loader would rely on. */
export async function readRememberedFile(handleStore: FileHandleStore): Promise<ProbeOutcome> {
  try {
    const rememberedHandle = await handleStore.load();
    if (!rememberedHandle) return { isPassed: false, detail: 'nothing remembered yet — pick a file first' };
    const permissionState = await (rememberedHandle.requestPermission?.({ mode: 'read' }) ?? Promise.resolve('granted' as PermissionState));
    if (permissionState !== 'granted') return { isPassed: false, detail: `permission ${permissionState}` };
    const rememberedFile = await rememberedHandle.getFile();
    return { isPassed: true, detail: `read ${rememberedFile.name} again from memory` };
  } catch (caughtError) {
    return { isPassed: false, detail: describeError(caughtError) };
  }
}

const HANDLE_DATABASE_NAME = 'snowWizardProbe';
const HANDLE_STORE_NAME = 'fileHandles';
const HANDLE_RECORD_KEY = 'wizardFile';

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(HANDLE_DATABASE_NAME, 1);
    openRequest.onupgradeneeded = () => openRequest.result.createObjectStore(HANDLE_STORE_NAME);
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

/** The real store: IndexedDB in this window's origin (ServiceNow's), the only storage that can hold a file handle. */
export function createIndexedDbHandleStore(): FileHandleStore {
  const runInStore = async <Result>(mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest<Result>) => {
    const handleDatabase = await openHandleDatabase();
    return new Promise<Result>((resolve, reject) => {
      const storeRequest = action(handleDatabase.transaction(HANDLE_STORE_NAME, mode).objectStore(HANDLE_STORE_NAME));
      storeRequest.onsuccess = () => resolve(storeRequest.result);
      storeRequest.onerror = () => reject(storeRequest.error);
    });
  };
  return {
    save: async (fileHandle) => { await runInStore('readwrite', (objectStore) => objectStore.put(fileHandle, HANDLE_RECORD_KEY)); },
    load: async () => (await runInStore('readonly', (objectStore) => objectStore.get(HANDLE_RECORD_KEY))) ?? null,
  };
}
