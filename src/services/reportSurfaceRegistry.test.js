// Unit tests for the report surface registry.

'use strict';

const { getSurface, listSurfaces, SURFACE_IDS } = require('./reportSurfaceRegistry');

describe('reportSurfaceRegistry', () => {
  test('exposes exactly the four report surfaces', () => {
    expect(SURFACE_IDS.sort()).toEqual(['feature-change', 'hygiene-digest', 'monthly-delivery', 'scope-change', 'standup-briefing']);
    expect(listSurfaces()).toHaveLength(5);
  });

  test('getSurface returns null for an unknown id', () => {
    expect(getSurface('git-state')).toBeNull();
  });

  test('every surface exposes id, label, and a report shape for docs', () => {
    for (const surface of listSurfaces()) {
      expect(typeof surface.id).toBe('string');
      expect(typeof surface.label).toBe('string');
      expect(typeof surface.reportShape).toBe('string');
      expect(typeof surface.resolveDestination).toBe('function');
    }
  });

  describe('standup-briefing resolver', () => {
    const configuration = {
      scheduler: {
        standupBriefing: {
          teamReports: [
            { teamName: 'Team Alpha', projectKeys: ['DENP'], triggerUrl: 'https://x.atlassian.net/h', triggerSecret: 's3cret' },
          ],
        },
      },
    };

    test('resolves by team name', () => {
      const dest = getSurface('standup-briefing').resolveDestination(configuration, 'Team Alpha');
      expect(dest).toMatchObject({ triggerUrl: 'https://x.atlassian.net/h', triggerSecret: 's3cret', projectKey: 'DENP' });
    });

    test('resolves by project key (from projectKeys)', () => {
      const dest = getSurface('standup-briefing').resolveDestination(configuration, 'denp');
      expect(dest.triggerUrl).toBe('https://x.atlassian.net/h');
    });

    test('returns null when no team matches', () => {
      expect(getSurface('standup-briefing').resolveDestination(configuration, 'Nope')).toBeNull();
    });
  });

  describe('scope-change / feature-change resolvers', () => {
    const configuration = {
      scheduler: {
        scopeChange: { teamReports: [{ teamName: 'Beta', projectKey: 'BETA', triggerUrl: 'https://c.atlassian.net/s', triggerSecret: '' }] },
        featureChange: { teamReports: [{ teamName: 'Beta', projectKey: 'BETA', triggerUrl: 'https://c.atlassian.net/f' }] },
      },
    };

    test('scope-change resolves by project key', () => {
      const dest = getSurface('scope-change').resolveDestination(configuration, 'BETA');
      expect(dest.triggerUrl).toBe('https://c.atlassian.net/s');
      expect(dest.triggerSecret).toBe('');
    });

    test('feature-change resolves by team name', () => {
      const dest = getSurface('feature-change').resolveDestination(configuration, 'Beta');
      expect(dest.triggerUrl).toBe('https://c.atlassian.net/f');
    });

    test('returns null when the matched team has no triggerUrl', () => {
      const noUrl = { scheduler: { scopeChange: { teamReports: [{ teamName: 'Beta', projectKey: 'BETA', triggerUrl: '' }] } } };
      expect(getSurface('scope-change').resolveDestination(noUrl, 'BETA')).toBeNull();
    });
  });

  describe('hygiene-digest resolver', () => {
    const configuration = {
      hygieneMonitor: {
        teams: [
          {
            teamName: 'Platform',
            projectKeys: ['PLAT'],
            digestTriggerUrl: 'https://contoso.atlassian.net/automation/webhooks/abc',
            digestTriggerSecret: 'digest-secret',
          },
        ],
      },
    };

    test('resolves by team name', () => {
      const destination = getSurface('hygiene-digest').resolveDestination(configuration, 'Platform');
      expect(destination).toMatchObject({
        triggerUrl:    'https://contoso.atlassian.net/automation/webhooks/abc',
        triggerSecret: 'digest-secret',
        teamName:      'Platform',
      });
    });

    test('resolution is case-insensitive on team name', () => {
      const destination = getSurface('hygiene-digest').resolveDestination(configuration, 'platform');
      expect(destination).not.toBeNull();
    });

    test('returns null when the team has no digest trigger webhook URL', () => {
      const noWebhook = { hygieneMonitor: { teams: [{ teamName: 'Platform', digestTriggerUrl: '' }] } };
      expect(getSurface('hygiene-digest').resolveDestination(noWebhook, 'Platform')).toBeNull();
    });

    test('returns null when the team name does not match', () => {
      expect(getSurface('hygiene-digest').resolveDestination(configuration, 'Unknown')).toBeNull();
    });
  });

  describe('monthly-delivery resolver', () => {
    test('resolves the single panel-configured webhook regardless of teamId', () => {
      const configuration = {
        scheduler: { monthlyDelivery: { triggerUrl: 'https://api-private.atlassian.com/automation/webhooks/x', triggerSecret: 's3cr3t' } },
      };

      const destination = getSurface('monthly-delivery').resolveDestination(configuration, 'anything');

      expect(destination).toEqual({
        triggerUrl: 'https://api-private.atlassian.com/automation/webhooks/x',
        triggerSecret: 's3cr3t',
        teamName: 'All teams',
        projectKey: '',
      });
    });

    test('returns null when no webhook is configured, so delivery is skipped not errored', () => {
      expect(getSurface('monthly-delivery').resolveDestination({ scheduler: { monthlyDelivery: {} } }, 'x')).toBeNull();
      expect(getSurface('monthly-delivery').resolveDestination({}, 'x')).toBeNull();
    });
  });
});
