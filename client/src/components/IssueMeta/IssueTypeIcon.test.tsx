// IssueTypeIcon.test.tsx — Unit tests for the issue-type icon chip.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IssueTypeIcon } from './IssueTypeIcon.tsx';

describe('IssueTypeIcon', () => {
  it('renders the icon plus the type name by default', () => {
    render(<IssueTypeIcon issueTypeName="Defect" />);
    const typeChip = screen.getByText(/Defect/);
    expect(typeChip).toHaveAttribute('data-tone', 'danger');
    expect(typeChip.textContent).toContain('🐞');
  });

  it('can hide the visible label while keeping it for assistive tech', () => {
    render(<IssueTypeIcon issueTypeName="Story" showLabel={false} />);
    expect(screen.getByLabelText('Story')).toBeInTheDocument();
  });
});
