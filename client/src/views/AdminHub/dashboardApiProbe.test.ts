// dashboardApiProbe.test.ts — Proves the read-only probe summarises each endpoint without leaking bulk.
//
// The probe's report is pasted back to a developer to decide whether dashboards and rich filters can be
// imported automatically, so it must say clearly which paths answered, what shape they returned, and
// which installed app looks like Rich Filters — while keeping every snippet short.

import { describe, expect, it } from 'vitest';

import {
  PROBE_SNIPPET_LENGTH,
  buildProbePaths,
  describeRedirectTarget,
  isRedirectStatus,
  findRichFilterApps,
  readStatusFromFailure,
  summarizeProbeBody,
  formatProbeReport,
} from './dashboardApiProbe.ts';

describe('buildProbePaths', () => {
  it('starts with the documented read-only Jira endpoints', () => {
    const paths = buildProbePaths([], '');
    expect(paths).toContain('/rest/api/2/serverInfo');
    expect(paths).toContain('/rest/api/2/dashboard?filter=my');
    expect(paths).toContain('/rest/api/2/filter/favourite');
  });

  it('adds a detail path per discovered dashboard id and the custom path when given', () => {
    const paths = buildProbePaths(['42'], '/rest/custom/1.0/thing');
    expect(paths).toContain('/rest/api/2/dashboard/42');
    expect(paths.some((path) => path.includes('42') && path.includes('gadget'))).toBe(true);
    expect(paths[paths.length - 1]).toBe('/rest/custom/1.0/thing');
  });

  it('refuses a custom path that is not a Jira REST path', () => {
    expect(buildProbePaths([], 'https://elsewhere.example/x')).not.toContain('https://elsewhere.example/x');
    expect(buildProbePaths([], '/secure/Dashboard.jspa')).not.toContain('/secure/Dashboard.jspa');
  });
});

describe('readStatusFromFailure', () => {
  it('reads the HTTP status out of a jiraGet failure message', () => {
    expect(readStatusFromFailure('Jira GET /rest/x failed: 404 — Not Found')).toBe(404);
    expect(readStatusFromFailure('Jira GET /rest/x failed: 403')).toBe(403);
    expect(readStatusFromFailure('network down')).toBeNull();
  });
});

describe('summarizeProbeBody', () => {
  it('describes an array by its length and the keys of its first item', () => {
    const summary = summarizeProbeBody([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
    expect(summary.shape).toBe('array(2) of {id, name}');
  });

  it('describes an object by its top-level keys and caps the snippet length', () => {
    const summary = summarizeProbeBody({ dashboards: [], total: 3, longText: 'x'.repeat(5000) });
    expect(summary.shape).toBe('object {dashboards, total, longText}');
    expect(summary.snippet.length).toBeLessThanOrEqual(PROBE_SNIPPET_LENGTH);
  });
});

describe('findRichFilterApps', () => {
  it('picks installed apps whose key or name mentions rich filters', () => {
    const plugins = {
      plugins: [
        { key: 'com.qotilabs.jira.rich-filters-plugin', name: 'Rich Filters for Jira Dashboards', enabled: true },
        { key: 'com.atlassian.jira.plugin.system.reports', name: 'Reports', enabled: true },
      ],
    };
    expect(findRichFilterApps(plugins)).toEqual([
      'com.qotilabs.jira.rich-filters-plugin — Rich Filters for Jira Dashboards',
    ]);
  });

  it('returns an empty list for an unexpected shape', () => {
    expect(findRichFilterApps(null)).toEqual([]);
    expect(findRichFilterApps({ nope: true })).toEqual([]);
  });
});

describe('formatProbeReport', () => {
  it('renders one line per probed path with status and shape, ready to paste back', () => {
    const report = formatProbeReport([
      { path: '/rest/api/2/serverInfo', status: 200, shape: 'object {version}', snippet: '{"version":"9.12"}' },
      { path: '/rest/x', status: 404, shape: '', snippet: 'Not Found' },
    ], ['app — Rich Filters']);
    expect(report).toContain('200  /rest/api/2/serverInfo');
    expect(report).toContain('404  /rest/x');
    expect(report).toContain('Rich Filters apps: app — Rich Filters');
  });
});

describe('isRedirectStatus', () => {
  it('is true only for 3xx statuses', () => {
    expect(isRedirectStatus(302)).toBe(true);
    expect(isRedirectStatus(301)).toBe(true);
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(404)).toBe(false);
    expect(isRedirectStatus(null)).toBe(false);
  });
});

describe('describeRedirectTarget', () => {
  it('recognises a redirect to the login page and does not follow it', () => {
    const target = describeRedirectTarget('https://jira.example.com/login.jsp?os_destination=%2Frest%2Fx');
    expect(target.followPath).toBeNull();
    expect(target.note).toMatch(/login/i);
  });

  it('follows a redirect to another Jira REST address, absolute or relative', () => {
    expect(describeRedirectTarget('https://jira.example.com/rest/rich/2.0/filters?x=1').followPath).toBe('/rest/rich/2.0/filters?x=1');
    expect(describeRedirectTarget('/rest/rich/2.0/filters/').followPath).toBe('/rest/rich/2.0/filters/');
  });

  it('does not follow a redirect to a non-REST page, and says so', () => {
    const target = describeRedirectTarget('https://jira.example.com/secure/Dashboard.jspa');
    expect(target.followPath).toBeNull();
    expect(target.note).toMatch(/not a REST/i);
  });
});

describe('formatProbeReport redirects', () => {
  it('prints each redirect hop under its endpoint', () => {
    const report = formatProbeReport([
      { path: '/rest/rich/1.0/x', status: 302, shape: '', snippet: 'failed: 302', redirects: ['302 → /rest/rich/2.0/x', '200  /rest/rich/2.0/x'] },
    ], []);
    expect(report).toContain('302  /rest/rich/1.0/x');
    expect(report).toContain('↳ 302 → /rest/rich/2.0/x');
    expect(report).toContain('↳ 200  /rest/rich/2.0/x');
  });
});
