// IssueFieldEditingSection.test.tsx — Tests that the section gates editors by editmeta and delegates writes.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';

const { mockSaveSimpleField } = vi.hoisted(() => ({ mockSaveSimpleField: vi.fn() }));

vi.mock('../../views/SprintDashboard/featureReviewFixes.ts', () => ({
  readFeatureReviewSelectOptions: () => [{ label: 'High', value: 'High' }],
  saveFeatureReviewSimpleField: mockSaveSimpleField,
  saveFeatureReviewOptionField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewUserField: vi.fn().mockResolvedValue(undefined),
  searchFeatureReviewUsers: vi.fn().mockResolvedValue([]),
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
