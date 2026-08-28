// relayOriginMatch.test.ts — Telling a wrong-tab relay apart from a dropped VPN.

import { describe, expect, it } from 'vitest';

import { compareRelayOrigin, describeRefusal, readOrigin } from './relayOriginMatch.ts';

describe('readOrigin', () => {
  it('reads the origin of a full SharePoint URL', () => {
    expect(readOrigin('https://contoso.sharepoint.com/sites/Delivery/Shared%20Documents'))
      .toBe('https://contoso.sharepoint.com');
  });

  it('is not fooled by casing, which a pasted URL often is', () => {
    expect(readOrigin('https://CONTOSO.sharepoint.com/sites/A')).toBe('https://contoso.sharepoint.com');
  });

  it('returns nothing for a half-typed URL rather than throwing', () => {
    // A setting somebody is midway through editing must not take a diagnostic panel down with it.
    expect(readOrigin('https://')).toBeNull();
    expect(readOrigin('not a url')).toBeNull();
  });

  it('returns nothing for an absent or empty URL', () => {
    expect(readOrigin(null)).toBeNull();
    expect(readOrigin('   ')).toBeNull();
  });
});

describe('compareRelayOrigin', () => {
  it('agrees when the relay is on the configured site', () => {
    const verdict = compareRelayOrigin(
      'https://contoso.sharepoint.com',
      'https://contoso.sharepoint.com/sites/Delivery/Shared Documents',
    );

    expect(verdict).toEqual({ kind: 'match' });
  });

  it('catches the OneDrive host, which looks close enough to be missed by eye', () => {
    // contoso-my.sharepoint.com and contoso.sharepoint.com are different sites entirely.
    const verdict = compareRelayOrigin(
      'https://contoso-my.sharepoint.com',
      'https://contoso.sharepoint.com/sites/Delivery',
    );

    expect(verdict.kind).toBe('mismatch');
  });

  it('names both sides, so the reader knows which tab to open', () => {
    const verdict = compareRelayOrigin('https://a.sharepoint.com', 'https://b.sharepoint.com/sites/X');

    expect(verdict).toEqual({
      kind: 'mismatch',
      relayOrigin: 'https://a.sharepoint.com',
      configuredOrigin: 'https://b.sharepoint.com',
    });
  });

  it('says unknown rather than guessing a match when the relay origin is missing', () => {
    // Claiming they agree would put the reader back to being told to reconnect a working VPN.
    expect(compareRelayOrigin(null, 'https://contoso.sharepoint.com/sites/X')).toEqual({ kind: 'unknown' });
  });

  it('says unknown when nothing has been configured to compare against', () => {
    expect(compareRelayOrigin('https://contoso.sharepoint.com', null)).toEqual({ kind: 'unknown' });
  });

  it('ignores the path, which differs on every request', () => {
    const verdict = compareRelayOrigin(
      'https://contoso.sharepoint.com/sites/Delivery/Forms/AllItems.aspx',
      'https://contoso.sharepoint.com/sites/Delivery/Shared Documents',
    );

    expect(verdict.kind).toBe('match');
  });
});

describe('describeRefusal', () => {
  it('states a mismatch as the cause, because it certainly is one', () => {
    // The request never reached the site holding the documents.
    const message = describeRefusal({
      kind: 'mismatch',
      relayOrigin: 'https://contoso-my.sharepoint.com',
      configuredOrigin: 'https://contoso.sharepoint.com',
    });

    expect(message).toContain('https://contoso-my.sharepoint.com');
    expect(message).toContain('reaching the wrong place entirely');
    expect(message).toContain('click the bookmarklet in THAT tab');
  });

  it('offers the VPN as a possibility, not a diagnosis, when the origins agree', () => {
    // The relay cannot see a VPN and should not claim to.
    const message = describeRefusal({ kind: 'match' });

    expect(message).toContain('the relay itself is fine');
    expect(message).toContain('usually');
    expect(message).not.toContain('which normally means the VPN has dropped');
  });

  it('says the same careful thing when it could not compare at all', () => {
    expect(describeRefusal({ kind: 'unknown' })).toContain('SharePoint is refusing the request');
  });
});
