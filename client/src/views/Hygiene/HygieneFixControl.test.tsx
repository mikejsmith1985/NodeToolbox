// HygieneFixControl.test.tsx — Proves each Hygiene flag renders the right inline fix and that a
// fix invokes the matching Feature Review write helper before refreshing the finding.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The control delegates every Jira write to the proven Feature Review helpers; mock them so the
// tests assert the control calls the correct helper with the correct arguments per fix kind.
vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewUserField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewOptionField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewIssueLinkField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewFixVersion: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewStoryPoints: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewTransition: vi.fn().mockResolvedValue(undefined),
  fetchFeatureReviewTransitions: vi.fn().mockResolvedValue([{ id: '31', name: 'Start Progress' }]),
  fetchFeatureReviewEditMeta: vi.fn().mockResolvedValue({}),
  fetchFeatureReviewFixVersions: vi.fn().mockResolvedValue([]),
  readFeatureReviewSelectOptions: vi.fn().mockReturnValue([]),
  searchFeatureReviewUsers: vi.fn().mockResolvedValue([]),
  readProjectKeyFromIssueKey: (issueKey: string) => issueKey.split('-', 1)[0],
}));

import { HygieneFixControl } from './HygieneFixControl.tsx';
import {
  resolveHygieneFieldConfig,
  type HygieneFlag,
  type JiraIssue,
} from './checks/hygieneChecks.ts';
import {
  saveFeatureReviewSimpleField,
  saveFeatureReviewTransition,
} from '../SprintDashboard/featureReviewFixes.ts';

const FIELD_CONFIG = resolveHygieneFieldConfig();

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
      expect(saveFeatureReviewTransition).toHaveBeenCalledWith('TBX-1', '31');
    });
    expect(onFixed).toHaveBeenCalledWith('TBX-1');
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
