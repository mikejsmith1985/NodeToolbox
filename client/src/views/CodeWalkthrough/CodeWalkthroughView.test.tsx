// CodeWalkthroughView.test.tsx — Unit tests for the Code Walkthrough static documentation view.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CodeWalkthroughView from './CodeWalkthroughView.tsx';

describe('CodeWalkthroughView', () => {
  it('renders the page title', () => {
    render(<CodeWalkthroughView />);
    expect(screen.getByRole('heading', { name: /code walkthrough/i })).toBeInTheDocument();
  });

  it('renders the current-application sections in the sidebar — no retired workspaces', () => {
    render(<CodeWalkthroughView />);
    expect(screen.getByRole('link', { name: /architecture/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home & navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /agile hub/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /my issues & today/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /hygiene workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /jira create/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /feature canvas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reports hub/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /snow hub/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /admin hub/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ai assist model/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /schedulers & automation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /security model/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /data flow & services/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /jira write paths/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /snow write paths/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tech stack/i })).toBeInTheDocument();
    // Retired workspaces must not resurface as sections.
    expect(screen.queryByRole('link', { name: /team dashboard features/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /art view features/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /business helper/i })).not.toBeInTheDocument();
  });

  it('never mentions retired tools anywhere in the documentation body', () => {
    render(<CodeWalkthroughView />);
    expect(screen.queryByText(/business helper/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stablization/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dev workspace/i)).not.toBeInTheDocument();
  });

  it('renders all section headings in the main content', () => {
    render(<CodeWalkthroughView />);
    expect(screen.getAllByRole('heading', { name: /architecture/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: /security model/i }).length).toBeGreaterThan(0);
  });

  it('renders workflow playbooks and troubleshooting guidance for feature-heavy sections', () => {
    render(<CodeWalkthroughView />);

    expect(screen.getAllByRole('heading', { name: /workflow playbooks/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: /troubleshooting/i }).length).toBeGreaterThan(0);
    // The playbooks describe the CURRENT navigation: Agile Hub spaces, not standalone tools.
    expect(screen.getByText(/open the agile hub and stay in the team space/i)).toBeInTheDocument();
    expect(screen.getByText(/if a pi review page does not appear/i)).toBeInTheDocument();
  });

  it('documents the guided hygiene cleanup session and the F1 to-do quick add', () => {
    render(<CodeWalkthroughView />);

    expect(screen.getAllByText(/skip \(s\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/f1/i).length).toBeGreaterThan(0);
  });

  it('filters sections when a search query matches', () => {
    render(<CodeWalkthroughView />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'feature review' } });
    expect(screen.getAllByRole('heading', { name: /agile hub/i }).length).toBeGreaterThan(0);
  });

  it('shows no-results message when search query matches nothing', () => {
    render(<CodeWalkthroughView />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'xyznonexistent123' } });
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('shows the tour bar when Start Guided Tour is clicked', () => {
    render(<CodeWalkthroughView />);
    const tourButton = screen.getByRole('button', { name: /guided tour/i });
    fireEvent.click(tourButton);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument();
  });

  it('advances tour step when Next is clicked', () => {
    render(<CodeWalkthroughView />);
    fireEvent.click(screen.getByRole('button', { name: /guided tour/i }));
    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });
});
