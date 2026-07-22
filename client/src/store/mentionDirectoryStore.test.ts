// mentionDirectoryStore.test.ts — Unit tests for the session directory of mentioned people.
//
// Two behaviours here are load-bearing and easy to break later: every identifier must reach a
// terminal state (a loading marker that never resolves would spin forever), and the lookup burst
// must be bounded WITHOUT capping how many people get resolved. Capping the total would leave
// resolvable people showing the "cannot be identified" placeholder — the exact conflation the
// spec forbids.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockJiraGet = vi.fn();

vi.mock('../services/jiraApi.ts', () => ({
  jiraGet: (path: string) => mockJiraGet(path),
}));

const { MAX_CONCURRENT_LOOKUPS, useMentionDirectoryStore } = await import('./mentionDirectoryStore.ts');

/** A promise whose resolution this test controls, for observing how many lookups are in flight. */
function createDeferred<ValueType>() {
  let resolvePromise!: (value: ValueType) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<ValueType>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolvePromise, rejectPromise };
}

function readEntry(identifier: string) {
  return useMentionDirectoryStore.getState().entriesByIdentifier[identifier];
}

beforeEach(() => {
  mockJiraGet.mockReset();
  useMentionDirectoryStore.setState({ entriesByIdentifier: {} });
});

// ── Seeding: names the app already has, at no request cost ──

describe('seedFromUsers', () => {
  it('records a display name as resolved without any request', () => {
    useMentionDirectoryStore.getState().seedFromUsers([
      { userIdentifier: 'accountId:557058:ab-12', displayName: 'Jane Doe' },
    ]);

    expect(readEntry('accountId:557058:ab-12')).toEqual({ status: 'resolved', displayName: 'Jane Doe' });
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('ignores entries with an empty identifier or display name', () => {
    useMentionDirectoryStore.getState().seedFromUsers([
      { userIdentifier: '', displayName: 'Nobody' },
      { userIdentifier: 'name:ghost', displayName: '' },
    ]);

    expect(useMentionDirectoryStore.getState().entriesByIdentifier).toEqual({});
  });

  it('is idempotent and never downgrades an already-resolved name', () => {
    const { seedFromUsers } = useMentionDirectoryStore.getState();
    seedFromUsers([{ userIdentifier: 'name:jsmith', displayName: 'Jane Smith' }]);
    seedFromUsers([{ userIdentifier: 'name:jsmith', displayName: 'Jane Smith' }]);

    expect(readEntry('name:jsmith')).toEqual({ status: 'resolved', displayName: 'Jane Smith' });
  });
});

// ── De-duplication: never ask twice for the same person ──

describe('resolveMissing — de-duplication', () => {
  it('issues one request when the same identifier appears several times', async () => {
    mockJiraGet.mockResolvedValue({ displayName: 'Jane Doe' });

    await useMentionDirectoryStore.getState().resolveMissing([
      'accountId:abc', 'accountId:abc', 'accountId:abc',
    ]);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('does not start a second lookup while the first is still pending', async () => {
    const deferred = createDeferred<{ displayName: string }>();
    mockJiraGet.mockReturnValue(deferred.promise);

    const firstCall = useMentionDirectoryStore.getState().resolveMissing(['accountId:abc']);
    const secondCall = useMentionDirectoryStore.getState().resolveMissing(['accountId:abc']);

    expect(readEntry('accountId:abc')).toEqual({ status: 'pending' });
    expect(mockJiraGet).toHaveBeenCalledTimes(1);

    deferred.resolvePromise({ displayName: 'Jane Doe' });
    await Promise.all([firstCall, secondCall]);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('issues no request for identifiers already resolved or unresolvable', async () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: {
        'name:known': { status: 'resolved', displayName: 'Known Person' },
        'name:gone': { status: 'unresolvable' },
      },
    });

    await useMentionDirectoryStore.getState().resolveMissing(['name:known', 'name:gone']);

    expect(mockJiraGet).not.toHaveBeenCalled();
  });
});

// ── Bounded concurrency: cap the rate, never the set ──

describe('resolveMissing — bounded concurrency', () => {
  it(`never exceeds ${MAX_CONCURRENT_LOOKUPS} in-flight lookups, and still resolves every person`, async () => {
    const identifiers = Array.from({ length: 12 }, (_unused, index) => `accountId:user-${index}`);
    let inFlightCount = 0;
    let peakInFlightCount = 0;

    mockJiraGet.mockImplementation(async () => {
      inFlightCount += 1;
      peakInFlightCount = Math.max(peakInFlightCount, inFlightCount);
      await Promise.resolve();
      inFlightCount -= 1;
      return { displayName: 'Someone' };
    });

    await useMentionDirectoryStore.getState().resolveMissing(identifiers);

    expect(peakInFlightCount).toBeLessThanOrEqual(MAX_CONCURRENT_LOOKUPS);
    // Bounding the RATE must not bound the SET — all 12 must end up resolved, or resolvable people
    // would be left showing the terminal "cannot be identified" placeholder.
    expect(mockJiraGet).toHaveBeenCalledTimes(12);
    identifiers.forEach((identifier) => {
      expect(readEntry(identifier)).toEqual({ status: 'resolved', displayName: 'Someone' });
    });
  });
});

// ── Terminal states: nothing may stay pending ──

describe('resolveMissing — terminal states', () => {
  it('records a successful lookup as resolved', async () => {
    mockJiraGet.mockResolvedValue({ displayName: 'Jane Doe' });

    await useMentionDirectoryStore.getState().resolveMissing(['accountId:abc']);

    expect(readEntry('accountId:abc')).toEqual({ status: 'resolved', displayName: 'Jane Doe' });
  });

  it.each([
    ['a rejected lookup', () => mockJiraGet.mockRejectedValue(new Error('404 Not Found'))],
    ['a network error', () => mockJiraGet.mockRejectedValue(new Error('Failed to fetch'))],
    ['an empty response body', () => mockJiraGet.mockResolvedValue(null)],
    ['a response with no display name', () => mockJiraGet.mockResolvedValue({})],
  ])('records %s as unresolvable rather than leaving it pending', async (_label, arrangeMock) => {
    arrangeMock();

    await useMentionDirectoryStore.getState().resolveMissing(['accountId:ghost']);

    expect(readEntry('accountId:ghost')).toEqual({ status: 'unresolvable' });
  });

  it('lets the other lookups succeed when one of them fails', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path.includes('broken')) {
        throw new Error('boom');
      }
      return { displayName: 'Fine Person' };
    });

    await useMentionDirectoryStore.getState().resolveMissing([
      'accountId:broken', 'accountId:ok-1', 'accountId:ok-2',
    ]);

    expect(readEntry('accountId:broken')).toEqual({ status: 'unresolvable' });
    expect(readEntry('accountId:ok-1')).toEqual({ status: 'resolved', displayName: 'Fine Person' });
    expect(readEntry('accountId:ok-2')).toEqual({ status: 'resolved', displayName: 'Fine Person' });
  });

  it('leaves no entry pending once every lookup has settled', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path.includes('ghost')) {
        throw new Error('gone');
      }
      return { displayName: 'Someone' };
    });

    await useMentionDirectoryStore.getState().resolveMissing([
      'accountId:a', 'accountId:ghost', 'name:b',
    ]);

    const statuses = Object.values(useMentionDirectoryStore.getState().entriesByIdentifier)
      .map((entry) => entry.status);
    expect(statuses).not.toContain('pending');
  });
});

// ── Lookup transport: the right endpoint per instance flavour ──

describe('resolveMissing — request shape', () => {
  it('looks a Cloud person up by accountId', async () => {
    mockJiraGet.mockResolvedValue({ displayName: 'Jane Doe' });

    await useMentionDirectoryStore.getState().resolveMissing(['accountId:557058:ab-12']);

    expect(mockJiraGet).toHaveBeenCalledWith(expect.stringContaining('accountId=557058%3Aab-12'));
  });

  it('falls back to a user-key lookup when a bare name is not a username', async () => {
    // A bare "[~X]" body cannot say whether X is a username or a user key, so both are tried —
    // mirroring the legacy retry the app's existing Jira user search already performs.
    mockJiraGet
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockResolvedValueOnce({ displayName: 'Bob Key' });

    await useMentionDirectoryStore.getState().resolveMissing(['name:JIRAUSER123']);

    expect(mockJiraGet).toHaveBeenNthCalledWith(1, expect.stringContaining('username=JIRAUSER123'));
    expect(mockJiraGet).toHaveBeenNthCalledWith(2, expect.stringContaining('key=JIRAUSER123'));
    expect(readEntry('name:JIRAUSER123')).toEqual({ status: 'resolved', displayName: 'Bob Key' });
  });
});

// ── Nothing is written to durable storage (guards against a later "improvement") ──

describe('durability', () => {
  it('never writes to localStorage or sessionStorage', async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    mockJiraGet.mockResolvedValue({ displayName: 'Jane Doe' });

    useMentionDirectoryStore.getState().seedFromUsers([
      { userIdentifier: 'name:jsmith', displayName: 'Jane Smith' },
    ]);
    await useMentionDirectoryStore.getState().resolveMissing(['accountId:abc']);

    expect(localStorageSpy).not.toHaveBeenCalled();
    localStorageSpy.mockRestore();
  });
});
