// HygieneFixControl.test.tsx — Proves each Hygiene flag renders the right inline fix and that a
// fix invokes the matching Feature Review write helper before refreshing the finding.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The issue SEARCH goes straight to Jira rather than through a Feature Review helper, so it needs
// its own mock. Defaults to an empty result, which is what the control saw before this file mocked
// it at all — so nothing else in here changes behaviour.
const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/jiraApi.ts')>()),
  jiraGet: mockJiraGet,
}));

// The control delegates every Jira write to the proven Feature Review helpers; mock the network
// and write functions so the tests assert the control calls the correct helper with the correct
// arguments per fix kind. Pure helpers (selection completeness, payload building, field support)
// stay REAL so the gating behavior under test is the shipped logic, not a re-implementation.
vi.mock('../SprintDashboard/featureReviewFixes.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../SprintDashboard/featureReviewFixes.ts')>()),
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewUserField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewOptionField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewIssueLinkField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewFixVersion: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewStoryPoints: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewTransition: vi.fn().mockResolvedValue(undefined),
  fetchFeatureReviewTransitions: vi.fn().mockResolvedValue([{ id: '31', name: 'Start Progress', requiredFields: [] }]),
  fetchFeatureReviewEditMeta: vi.fn().mockResolvedValue({}),
  fetchFeatureReviewFixVersions: vi.fn().mockResolvedValue([]),
  readFeatureReviewSelectOptions: vi.fn().mockReturnValue([]),
  searchFeatureReviewUsers: vi.fn().mockResolvedValue([]),
}));

import { HygieneFixControl, buildLinkSearchJql } from './HygieneFixControl.tsx';
import {
  resolveHygieneFieldConfig,
  type HygieneFlag,
  type JiraIssue,
} from './checks/hygieneChecks.ts';
import {
  fetchFeatureReviewTransitions,
  readFeatureReviewSelectOptions,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewTransition,
} from '../SprintDashboard/featureReviewFixes.ts';

const FIELD_CONFIG = resolveHygieneFieldConfig();
// A config where the Application field id resolves, so the control takes the dropdown path
// (not the "field not configured" link) — the state the user sees in the screenshot.
const APPLICATION_FIELD_CONFIG = { ...FIELD_CONFIG, applicationFieldIds: ['customfield_50001'] };

function buildIssue(key = 'TBX-1'): JiraIssue {
  return { key, fields: { summary: '' } };
}

function buildFlag(checkId: HygieneFlag['checkId'], label: string, severity: HygieneFlag['severity'] = 'warn'): HygieneFlag {
  return { checkId, label, severity };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HygieneFixControl', () => {
  it('renders a text input + Fix for a text flag and calls saveFeatureReviewSimpleField then refreshes', async () => {
    const onFixed = vi.fn();
    render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('missing-summary', 'Missing Feature Name / Summary', 'error')}
        fieldConfig={FIELD_CONFIG}
        onFixed={onFixed}
      />,
    );

    fireEvent.change(screen.getByLabelText('Set summary'), { target: { value: 'A real name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('TBX-1', 'summary', 'A real name');
    });
    expect(onFixed).toHaveBeenCalledWith('TBX-1');
  });

  it('renders a transitions dropdown for a status-move flag and calls saveFeatureReviewTransition', async () => {
    const onFixed = vi.fn();
    render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('stale', 'Stale')}
        fieldConfig={FIELD_CONFIG}
        onFixed={onFixed}
      />,
    );

    const transitionSelect = screen.getByLabelText('Move status options');
    // The transition option is loaded asynchronously from fetchFeatureReviewTransitions.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Start Progress' })).toBeInTheDocument());
    fireEvent.change(transitionSelect, { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      // No required screen fields on this transition, so the fields payload is empty.
      expect(saveFeatureReviewTransition).toHaveBeenCalledWith('TBX-1', '31', {});
    });
    expect(onFixed).toHaveBeenCalledWith('TBX-1');
  });

  it('gates Fix on a transition\'s required screen fields and submits the collected answers (GH #177 follow-up)', async () => {
    // Real-world 400: "The following fields are required: Application Component Selection,
    // Defect Root Cause". The control must collect both inline and post them with the transition.
    vi.mocked(fetchFeatureReviewTransitions).mockResolvedValue([
      {
        id: '41',
        name: 'Close Defect',
        to: { name: 'Closed', statusCategory: { name: 'Done' } },
        requiredFields: [
          {
            fieldId: 'cfRootCause',
            name: 'Defect Root Cause',
            schemaType: 'option',
            allowedValues: [{ id: '900', value: 'Code' }, { id: '901', value: 'Config' }],
          },
          {
            fieldId: 'cfComponent',
            name: 'Application Component Selection',
            schemaType: 'option-with-child',
            allowedValues: [{ id: '800', value: 'Facets', children: [{ id: '810', value: 'Eligibility' }] }],
          },
        ],
      },
    ]);
    const onFixed = vi.fn();
    render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('stale', 'Stale')}
        fieldConfig={FIELD_CONFIG}
        onFixed={onFixed}
      />,
    );

    await waitFor(() => expect(screen.getByRole('option', { name: 'Close Defect' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Move status options'), { target: { value: '41' } });

    // Fix stays disabled until every required field is answered — no more blind 400s.
    const fixButton = screen.getByRole('button', { name: 'Fix' });
    expect(fixButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Defect Root Cause'), { target: { value: '900' } });
    expect(fixButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Application Component Selection'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Application Component Selection — detail'), { target: { value: '810' } });
    expect(fixButton).toBeEnabled();

    fireEvent.click(fixButton);

    await waitFor(() => {
      expect(saveFeatureReviewTransition).toHaveBeenCalledWith('TBX-1', '41', {
        cfRootCause: { id: '900' },
        cfComponent: { id: '800', child: { id: '810' } },
      });
    });
    expect(onFixed).toHaveBeenCalledWith('TBX-1');
  });

  it('falls back to an Open in Jira link when a select field loads with no options (dead-dropdown fix)', async () => {
    // The Application field resolves, but Jira returns no allowed values → an empty, greyed dropdown
    // is useless. The control must offer the working Jira path instead.
    render(
      <HygieneFixControl
        issue={buildIssue('ENFCT-1')}
        flag={buildFlag('missing-application', 'Missing Application', 'error')}
        fieldConfig={APPLICATION_FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole('link', { name: /open in jira/i })).toBeInTheDocument());
    expect(screen.getByText(/no selectable options for this field/i)).toBeInTheDocument();
    // No dead dropdown is left on screen.
    expect(screen.queryByLabelText('Set application options')).not.toBeInTheDocument();
  });

  it('renders a working options dropdown for a select field that has choices, and saves the pick', async () => {
    vi.mocked(readFeatureReviewSelectOptions).mockReturnValue([{ label: 'Facets', value: '10001' }]);
    const onFixed = vi.fn();
    render(
      <HygieneFixControl
        issue={buildIssue('ENFCT-2')}
        flag={buildFlag('missing-application', 'Missing Application', 'error')}
        fieldConfig={APPLICATION_FIELD_CONFIG}
        onFixed={onFixed}
      />,
    );

    const applicationSelect = await screen.findByLabelText('Set application options');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Facets' })).toBeInTheDocument());
    fireEvent.change(applicationSelect, { target: { value: '10001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      // The 4th arg is the editmeta field (undefined here — the mock returns no field metadata).
      expect(saveFeatureReviewOptionField).toHaveBeenCalledWith('ENFCT-2', 'customfield_50001', '10001', undefined);
    });
    expect(onFixed).toHaveBeenCalledWith('ENFCT-2');
  });

  it('tells the user to search before an assignee dropdown can offer options', () => {
    render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('no-assignee', 'Assign owner', 'error')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    // The greyed, search-driven dropdown explains itself instead of looking broken.
    const assigneeSelect = screen.getByLabelText('Assign owner options');
    expect(assigneeSelect).toBeDisabled();
    // Names the box rather than its position: the search input sits BESIDE this dropdown, not above.
    expect(screen.getByRole('option', { name: /type a name in the search box/i })).toBeInTheDocument();
  });

  it('renders an Open in Jira link (no write control) for a derived openInJira flag', () => {
    render(
      <HygieneFixControl
        issue={buildIssue('OLD-9')}
        flag={buildFlag('old-in-sprint', 'Old in sprint')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: /open in jira/i })).toHaveAttribute('href', '/browse/OLD-9');
    // A derived flag offers no inline write control at all — only the link out.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('buildLinkSearchJql — where a Feature can actually be found', () => {
  it('does not restrict a FEATURE search to the issue\'s own project', () => {
    // Features live in a portfolio project, never the team's own — that separation is the whole
    // reason a Feature Link field exists. Scoping to the issue's project meant no query could match,
    // whatever was typed, which is exactly what was reported.
    const jql = buildLinkSearchJql('Transformers', true, 'ENFCT', ['Feature', 'Epic']);

    expect(jql).toContain('issuetype in ("Feature", "Epic")');
    // Wildcarded: `~` matches whole words, so a term still being typed matches nothing without it.
    expect(jql).toContain('summary ~ "Transformers*"');
    expect(jql).not.toContain('project = ENFCT');
  });

  it('still restricts a PARENT search to the same project, where a parent really does live', () => {
    const jql = buildLinkSearchJql('anything', false, 'ENFCT', ['Feature', 'Epic']);

    expect(jql).toContain('project = ENFCT');
    expect(jql).not.toContain('issuetype');
  });

  it('looks a pasted key up directly, without any project clause', () => {
    expect(buildLinkSearchJql('denp-1414', true, 'ENFCT', ['Feature', 'Epic']))
      .toBe('issuetype in ("Feature", "Epic") AND key = DENP-1414');
  });

  it('never names an issue type the instance does not define', () => {
    // The reported defect: Jira rejects the WHOLE query with a 400 when one value in an
    // `in (...)` list is unknown, so `issuetype in (Feature, Epic)` on an instance with no Epic
    // returned nothing for every search term typed (GH #376).
    const jql = buildLinkSearchJql('vul', true, 'ENCUC', ['Feature']);

    expect(jql).toContain('issuetype = "Feature"');
    expect(jql).not.toContain('Epic');
  });

  it('drops the restriction rather than run a query Jira will refuse', () => {
    // No feature-level type exists here at all. A broad search that returns issues beats a precise
    // one that 400s.
    const jql = buildLinkSearchJql('vul', true, 'ENCUC', []);

    expect(jql).toBe('summary ~ "vul*" ORDER BY updated DESC');
  });

  it('strips a quote rather than escaping it — Jira-s text index treats it as an operator', () => {
    const jql = buildLinkSearchJql('say "hi"', true, 'ENFCT', ['Feature']);

    expect(jql).toContain('summary ~ "say hi*"');
  });
});

describe('HygieneFixControl — the date pills own the dates now', () => {
  it('renders no control for a plain date flag: the card-s own pill writes that field', () => {
    // Two writers for one field, and the slower one was here: a label, a date box and a Fix button
    // to set a value the pill takes in one click.
    const { container } = render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('missing-due-date', 'Missing Due Date')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['missing-target-start', 'Missing Target Start'],
    ['missing-target-end', 'Missing Target End'],
  ] as const)('renders no control for %s either', (checkId, label) => {
    const { container } = render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag(checkId, label)}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the status transition on an overdue flag, and drops only its duplicate date box', async () => {
    // The rule names two remedies: move the work on, or move the date. The pill covers the second,
    // so losing the first would leave the flag with no fix at all.
    render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('due-date-overdue', 'Due date passed')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText('Move status options')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reschedule due date options')).toBeNull();
    expect(screen.queryByText('Reschedule due date:')).toBeNull();
  });

  it('still offers the release-derived date fix, which the pill cannot do', () => {
    // The pill takes a date somebody typed; this one WORKS OUT all three from the release.
    render(
      <HygieneFixControl
        issue={buildIssue()}
        flag={buildFlag('dates-out-of-sync', 'Dates disagree with the release')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    expect(screen.getByText(/Apply release dates|Working out|dates/i)).toBeInTheDocument();
  });
});

describe('the match terms — why the search never found anything', () => {
  /** The terms the JQL ends up carrying, read back through the only exported entry point. */
  function readMatchTerms(query: string): string | null {
    const jql = buildLinkSearchJql(query, true, 'ENFCT', ['Feature']);
    return jql === null ? null : /summary ~ "([^"]*)"/.exec(jql)?.[1] ?? null;
  }

  it('wildcards the term still being typed, because ~ matches WHOLE words', () => {
    // `summary ~ "crit"` finds nothing at all against "Critical Vulnerabilities". Anybody typing
    // while they think — which is everybody — saw an empty dropdown and concluded it was broken.
    expect(readMatchTerms('crit')).toBe('crit*');
  });

  it('leaves finished words alone and wildcards only the last', () => {
    // A space means that word is finished; widening it would match more for no reason.
    expect(readMatchTerms('critical vuln')).toBe('critical vuln*');
  });

  it('strips the reserved characters that made the query INVALID, not merely unmatched', () => {
    // A Feature summary routinely carries a key and a colon, so typing what you can see was the
    // surest way to get a 400 back instead of that issue.
    expect(readMatchTerms('ENCUC-1972: Critical')).toBe('ENCUC 1972 Critical*');
  });

  it('does not wildcard a single character, which would match most of the instance', () => {
    expect(readMatchTerms('a')).toBe('a');
  });

  it('returns nothing when the query is only reserved characters', () => {
    // Running it anyway would ask Jira a question with no terms in it.
    expect(readMatchTerms('***')).toBeNull();
    expect(readMatchTerms('   ')).toBeNull();
  });

  it('collapses runs of whitespace rather than emitting empty terms', () => {
    expect(readMatchTerms('  critical    vuln  ')).toBe('critical vuln*');
  });
});

describe('buildLinkSearchJql — a query that cannot match is not run', () => {
  it('returns no JQL at all when nothing usable survives', () => {
    expect(buildLinkSearchJql('***', true, 'ENFCT', ['Feature'])).toBeNull();
  });

  it('still looks a pasted key up, reserved hyphen and all', () => {
    expect(buildLinkSearchJql('DENP-1414', true, 'ENFCT', ['Feature']))
      .toBe('issuetype = "Feature" AND key = DENP-1414');
  });
});

describe('the Feature-link search says when Jira refused it', () => {
  it('shows Jira-s own words instead of an empty dropdown', async () => {
    // Previously the rejection was swallowed, so a refused query, an unknown issue type and a
    // genuine no-match all rendered identically — which is why this read as "the search NEVER
    // finds anything" (GH #375).
    mockJiraGet.mockRejectedValue(new Error("Field 'issuetype' value 'Feature' does not exist"));
    render(
      <HygieneFixControl
        issue={buildIssue('ENCUC-1983')}
        flag={buildFlag('missing-feature-link', 'Missing Feature Link')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Search issues for/i), { target: { value: 'critical' } });

    expect(await screen.findByRole('alert')).toHaveTextContent("value 'Feature' does not exist");
  });

  it('clears the message once a search succeeds', async () => {
    mockJiraGet.mockRejectedValueOnce(new Error('Jira is down'));
    render(
      <HygieneFixControl
        issue={buildIssue('ENCUC-1983')}
        flag={buildFlag('missing-feature-link', 'Missing Feature Link')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Search issues for/i), { target: { value: 'critical' } });
    await screen.findByRole('alert');

    mockJiraGet.mockResolvedValue({ issues: [{ key: 'DENP-1', fields: { summary: 'Critical Vulnerabilities' } }] });
    fireEvent.change(screen.getByLabelText(/Search issues for/i), { target: { value: 'critical v' } });

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers what Jira returned, so a successful search is visibly different from a failed one', async () => {
    mockJiraGet.mockResolvedValue({ issues: [{ key: 'DENP-1', fields: { summary: 'Critical Vulnerabilities' } }] });
    render(
      <HygieneFixControl
        issue={buildIssue('ENCUC-1983')}
        flag={buildFlag('missing-feature-link', 'Missing Feature Link')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Search issues for/i), { target: { value: 'critical' } });

    expect(await screen.findByRole('option', { name: /DENP-1 — Critical Vulnerabilities/ })).toBeInTheDocument();
  });

  it('asks Jira with a wildcard, so a half-typed word can match', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    render(
      <HygieneFixControl
        issue={buildIssue('ENCUC-1983')}
        flag={buildFlag('missing-feature-link', 'Missing Feature Link')}
        fieldConfig={FIELD_CONFIG}
        onFixed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Search issues for/i), { target: { value: 'crit' } });

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    const requestedPath = decodeURIComponent(String(mockJiraGet.mock.calls.at(-1)?.[0]));
    expect(requestedPath).toContain('summary ~ "crit*"');
  });
});
