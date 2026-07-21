// HygieneFixControl.test.tsx — Proves each Hygiene flag renders the right inline fix and that a
// fix invokes the matching Feature Review write helper before refreshing the finding.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { HygieneFixControl } from './HygieneFixControl.tsx';
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
    expect(screen.getByRole('option', { name: /type a name above to search/i })).toBeInTheDocument();
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
