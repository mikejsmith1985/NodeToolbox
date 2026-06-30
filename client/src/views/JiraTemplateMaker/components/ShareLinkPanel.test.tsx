// ShareLinkPanel.test.tsx — Component test for the shareable-link display.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ShareLinkPanel from './ShareLinkPanel.tsx';

describe('ShareLinkPanel', () => {
  it('shows the URL and a copy button when a link is available', () => {
    render(<ShareLinkPanel url="https://jira.example.com/secure/CreateIssueDetails!init.jspa?pid=1" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('CreateIssueDetails');
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('explains why the link is unavailable when there is no URL', () => {
    render(<ShareLinkPanel url="" unavailableReason="Pick a project first." />);
    expect(screen.getByText('Pick a project first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });
});
