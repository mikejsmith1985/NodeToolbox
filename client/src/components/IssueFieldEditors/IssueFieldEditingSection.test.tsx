// IssueFieldEditingSection.test.tsx — Tests that the section gates editors by editmeta and delegates writes.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';

const { mockSaveSimpleField, mockSaveFixVersion } = vi.hoisted(() => ({
  mockSaveSimpleField: vi.fn(),
  mockSaveFixVersion: vi.fn(),
}));

vi.mock('../../views/SprintDashboard/featureReviewFixes.ts', () => ({
  readFeatureReviewSelectOptions: () => [{ label: 'High', value: 'High' }],
  saveFeatureReviewSimpleField: mockSaveSimpleField,
  saveFeatureReviewOptionField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewUserField: vi.fn().mockResolvedValue(undefined),
  searchFeatureReviewUsers: vi.fn().mockResolvedValue([]),
  saveFeatureReviewFixVersion: mockSaveFixVersion,
}));

import { IssueFieldEditingSection } from './IssueFieldEditingSection.tsx';

const ISSUE = {
  key: 'TBX-1',
  fields: { summary: 'A summary', priority: { name: 'High' }, assignee: null },
} as unknown as JiraIssue;

describe('IssueFieldEditingSection', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when editmeta exposes none of the editable fields', () => {
    const { container } = render(
      <IssueFieldEditingSection issue={ISSUE} editMeta={{ description: { name: 'Description' } }} onFieldSaved={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the editors editmeta allows', () => {
    render(<IssueFieldEditingSection issue={ISSUE} editMeta={{ summary: { name: 'Summary' } }} onFieldSaved={vi.fn()} />);
    expect(screen.getByText('Edit fields')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(screen.queryByText('Assignee')).not.toBeInTheDocument();
  });

  it('delegates a summary edit to the simple-field writer with the issue key', async () => {
    mockSaveSimpleField.mockResolvedValue(undefined);
    const onFieldSaved = vi.fn();
    render(<IssueFieldEditingSection issue={ISSUE} editMeta={{ summary: { name: 'Summary' } }} onFieldSaved={onFieldSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Summary value'), { target: { value: 'Revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockSaveSimpleField).toHaveBeenCalledWith('TBX-1', 'summary', 'Revised'));
    await waitFor(() => expect(onFieldSaved).toHaveBeenCalledTimes(1));
  });
});

describe('IssueFieldEditingSection — fix version', () => {
  afterEach(() => vi.clearAllMocks());

  const FIX_VERSION_META = {
    fixVersions: { name: 'Fix Version/s', allowedValues: [{ name: '08/13/2026' }, { name: '09/10/2026' }] },
  };

  it('offers a Fix Version editor when editmeta allows it', () => {
    render(<IssueFieldEditingSection issue={ISSUE} editMeta={FIX_VERSION_META} onFieldSaved={vi.fn()} />);
    expect(screen.getByText('Fix Version')).toBeInTheDocument();
  });

  it('does not offer one when editmeta withholds the field', () => {
    render(
      <IssueFieldEditingSection issue={ISSUE} editMeta={{ summary: { name: 'Summary' } }} onFieldSaved={vi.fn()} />,
    );
    expect(screen.queryByText('Fix Version')).not.toBeInTheDocument();
  });

  it('saves the chosen version by NAME, which is what Jira accepts', async () => {
    mockSaveFixVersion.mockResolvedValue(undefined);
    const issueWithVersion = {
      key: 'TBX-1',
      fields: { summary: 'A summary', fixVersions: [{ name: '08/13/2026' }] },
    } as unknown as JiraIssue;

    render(
      <IssueFieldEditingSection issue={issueWithVersion} editMeta={FIX_VERSION_META} onFieldSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '09/10/2026' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockSaveFixVersion).toHaveBeenCalledWith('TBX-1', '09/10/2026'));
  });

  it('can clear the fix version, not only change it', async () => {
    mockSaveFixVersion.mockResolvedValue(undefined);
    const issueWithVersion = {
      key: 'TBX-1',
      fields: { summary: 'A summary', fixVersions: [{ name: '08/13/2026' }] },
    } as unknown as JiraIssue;

    render(
      <IssueFieldEditingSection issue={issueWithVersion} editMeta={FIX_VERSION_META} onFieldSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockSaveFixVersion).toHaveBeenCalledWith('TBX-1', ''));
  });

  it('warns before replacing several fix versions, so none is lost unseen', () => {
    const multiVersionIssue = {
      key: 'TBX-1',
      fields: { summary: 'A summary', fixVersions: [{ name: '08/13/2026' }, { name: '09/10/2026' }] },
    } as unknown as JiraIssue;

    render(
      <IssueFieldEditingSection issue={multiVersionIssue} editMeta={FIX_VERSION_META} onFieldSaved={vi.fn()} />,
    );
    expect(screen.getByText(/has 2 fix versions/)).toBeInTheDocument();
    expect(screen.getByText(/replaces all of them/)).toBeInTheDocument();
  });

  it('shows no replace warning for the ordinary single-version case', () => {
    const singleVersionIssue = {
      key: 'TBX-1',
      fields: { summary: 'A summary', fixVersions: [{ name: '08/13/2026' }] },
    } as unknown as JiraIssue;

    render(
      <IssueFieldEditingSection issue={singleVersionIssue} editMeta={FIX_VERSION_META} onFieldSaved={vi.fn()} />,
    );
    expect(screen.queryByText(/replaces all of them/)).not.toBeInTheDocument();
  });
});
