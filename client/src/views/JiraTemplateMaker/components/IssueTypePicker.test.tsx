// IssueTypePicker.test.tsx — Component test for the issue-type select.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CreateMetaIssueType } from '../../../types/jira.ts';
import IssueTypePicker from './IssueTypePicker.tsx';

const ISSUE_TYPES: CreateMetaIssueType[] = [
  { id: '1', name: 'Task', subtask: false },
  { id: '2', name: 'Bug', subtask: false },
];

describe('IssueTypePicker', () => {
  it('lists the project issue types and reports the chosen id and name', () => {
    const onChange = vi.fn();
    render(<IssueTypePicker id="it" label="Issue type" issueTypes={ISSUE_TYPES} value="" onChange={onChange} />);

    const optionLabels = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toEqual(['— Select an issue type —', 'Task', 'Bug']);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith('2', 'Bug');
  });
});
