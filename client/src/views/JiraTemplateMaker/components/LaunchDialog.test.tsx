// LaunchDialog.test.tsx — Component test: prompts only prompt-at-launch fields (T027), and
// surfaces the integration-account reporter note (T034).

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FieldDescriptor, JiraTemplate } from '../lib/templateTypes.ts';
import LaunchDialog from './LaunchDialog.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ createIssue: vi.fn() }));

const DESCRIPTORS: FieldDescriptor[] = [
  { fieldId: 'summary', name: 'Summary', required: true, internalType: 'text', isSupported: true, hasDefault: false },
  { fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice', isSupported: true, allowedValues: [{ id: '1', label: 'High' }], hasDefault: false },
];

const TEMPLATE: JiraTemplate = {
  id: 't', name: 'Weekly Ops', description: '', projectKey: 'ABC', projectId: '10000',
  issueTypeId: '1', issueTypeName: 'Task', authorName: 'x', createdAt: '', updatedAt: '',
  fields: [
    { fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'promptAtLaunch' },
    { fieldId: 'priority', fieldName: 'Priority', fieldType: 'choice', mode: 'fixed', value: { id: '1' } },
  ],
};

describe('LaunchDialog', () => {
  it('prompts only for prompt-at-launch fields, not fixed ones', () => {
    render(<LaunchDialog template={TEMPLATE} descriptors={DESCRIPTORS} onClose={vi.fn()} />);
    // Summary is prompt-at-launch → its input is shown.
    expect(screen.getByText('Summary')).toBeInTheDocument();
    // Priority is fixed → no Priority value control is rendered (no combobox).
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the integration-account reporter note when no reporter field is set', () => {
    render(<LaunchDialog template={TEMPLATE} descriptors={DESCRIPTORS} onClose={vi.fn()} />);
    expect(screen.getByText(/integration account/i)).toBeInTheDocument();
  });
});
