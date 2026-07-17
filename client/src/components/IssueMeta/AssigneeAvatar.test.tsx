// AssigneeAvatar.test.tsx — Unit tests for the assignee identity avatar.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssigneeAvatar } from './AssigneeAvatar.tsx';

describe('AssigneeAvatar', () => {
  it('renders initials plus the FULL display name — never a truncated one', () => {
    render(<AssigneeAvatar displayName="Katkar, Rahul (CTR)" />);
    expect(screen.getByText('KR')).toBeInTheDocument();
    expect(screen.getByText('Katkar, Rahul (CTR)')).toBeInTheDocument();
  });

  it('renders a distinct unassigned treatment for a missing assignee', () => {
    render(<AssigneeAvatar displayName={null} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });
});
