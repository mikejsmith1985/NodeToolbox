// relay.test.ts — Runtime shape checks for relay bridge type literals.

import { describe, expect, it } from 'vitest';

import type {
  RelayBridgeStatus,
  RelayChannel,
  RelaySystem,
} from './relay.ts';

describe('relay types', () => {
  it('accepts the supported relay system literal', () => {
    const relaySystem: RelaySystem = 'snow';

    expect(relaySystem).toBe('snow');
  });

  it('accepts a relay bridge status literal with the expected keys', () => {
    const relayBridgeStatus: RelayBridgeStatus = {
      system: 'snow',
      isConnected: true,
      lastPingAt: '2025-01-01T00:00:00.000Z',
      version: '1.0.0',
    };

    expect(relayBridgeStatus).toHaveProperty('system');
    expect(relayBridgeStatus).toHaveProperty('isConnected');
    expect(relayBridgeStatus).toHaveProperty('lastPingAt');
    expect(relayBridgeStatus).toHaveProperty('version');
  });

  it('accepts a relay channel literal with the expected keys', () => {
    const relayChannel: RelayChannel = {
      channelId: 'channel-1',
      system: 'snow',
      isRegistered: true,
    };

    expect(relayChannel).toHaveProperty('channelId');
    expect(relayChannel).toHaveProperty('system');
    expect(relayChannel).toHaveProperty('isRegistered');
  });
});
