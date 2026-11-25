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
  describeJiraIdentity,
  summarizeProbeReply,
  scanDashboardPage,
  buildDashboardPagePath,
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

describe('describeJiraIdentity', () => {
  it('names the signed-in user and the route, so nobody has to guess how the probe reached Jira', () => {
    expect(describeJiraIdentity({ status: 200, route: 'relay', upstreamLocation: null, body: { name: 'U564974', displayName: 'Smith, Mike' }, bodyText: '' }))
      .toBe('Signed in to Jira as U564974 (Smith, Mike) — through your Jira tab (your own session)');
    expect(describeJiraIdentity({ status: 200, route: 'token', upstreamLocation: null, body: { name: 'svc' }, bodyText: '' }))
      .toBe('Signed in to Jira as svc — through the stored Jira token (not your session; connect the Jira tab for session-only apps)');
  });

  it('says plainly when Jira did not recognise us', () => {
    expect(describeJiraIdentity({ status: 401, route: 'token', upstreamLocation: null, body: '', bodyText: '' }))
      .toBe('Not signed in to Jira (401) — through the stored Jira token (not your session; connect the Jira tab for session-only apps)');
  });
});

describe('summarizeProbeReply', () => {
  it('reports a JSON reply by status and shape', () => {
    const result = summarizeProbeReply('/rest/api/2/serverInfo', { status: 200, route: 'relay', upstreamLocation: null, body: { version: '11' }, bodyText: '' });
    expect(result).toMatchObject({ path: '/rest/api/2/serverInfo', status: 200, shape: 'object {version}' });
  });

  it('flags a call the Jira tab followed to the login page instead of calling it a success', () => {
    const result = summarizeProbeReply('/rest/rich/1.0/x', {
      status: 200, route: 'relay', upstreamLocation: 'https://jira.example/login.jsp?os_destination=x', body: '<html><title>Log in</title></html>', bodyText: '',
    });
    expect(result.shape).toBe('HTML page "Log in"');
    expect(result.redirects?.[0]).toMatch(/^redirected → https:\/\/jira\.example\/login\.jsp.*\(login page/);
  });
});

describe('scanDashboardPage', () => {
  const dashboardHtml = [
    '<script>AG.DashboardManager.setup({"gadgets":[',
    '{"id":"501","title":"Team","gadgetSpecUrl":"rest\\/gadgets\\/1.0\\/g\\/com.qotilabs.jira.rich-filters-plugin:rich-filter-results-gadget\\/gadget.xml"},',
    '{"id":"502","title":"Pie","gadgetSpecUrl":"rest/gadgets/1.0/g/com.atlassian.jira.gadgets:pie-chart-gadget/gadgets/piechart-gadget.xml"}',
    ']});</script><script src="/rest/qotilabs-richfilters/2.0/smart-filters?x=1"></script>',
  ].join('');

  it('lists each gadget, the REST areas the page calls, and every Rich Filters mention', () => {
    const scan = scanDashboardPage(dashboardHtml);
    expect(scan.gadgetSpecs).toEqual([
      'rest/gadgets/1.0/g/com.qotilabs.jira.rich-filters-plugin:rich-filter-results-gadget/gadget.xml',
      'rest/gadgets/1.0/g/com.atlassian.jira.gadgets:pie-chart-gadget/gadgets/piechart-gadget.xml',
    ]);
    expect(scan.restAreas).toContain('/rest/qotilabs-richfilters/2.0/');
    expect(scan.richFilterMentions.some((mention) => mention.includes('com.qotilabs.jira.rich-filters-plugin'))).toBe(true);
    expect(scan.gadgetIds).toEqual(['501', '502']);
  });

  it('returns empty lists for a page with nothing in it', () => {
    expect(scanDashboardPage('<html></html>')).toEqual({ gadgetSpecs: [], restAreas: [], richFilterMentions: [], gadgetIds: [] });
  });

  it('builds the dashboard page address for an id', () => {
    expect(buildDashboardPagePath('175112')).toBe('/secure/Dashboard.jspa?selectPageId=175112');
  });
});

describe('formatProbeReport extras', () => {
  it('opens with who the probe was signed in as and ends with each dashboard page scan', () => {
    const report = formatProbeReport([], [], { identityLine: 'Signed in to Jira as U1 — through your Jira tab', pageScanLines: ['Dashboard 42 page: 2 gadgets'] });
    const lines = report.split('\n');
    expect(lines[1]).toBe('Signed in to Jira as U1 — through your Jira tab');
    expect(report.trimEnd().endsWith('Dashboard 42 page: 2 gadgets')).toBe(true);
  });
});
