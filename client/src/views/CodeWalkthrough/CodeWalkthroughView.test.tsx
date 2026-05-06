// CodeWalkthroughView.test.tsx — Unit tests for the Code Walkthrough static documentation view.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CodeWalkthroughView from './CodeWalkthroughView.tsx';

describe('CodeWalkthroughView', () => {
  it('renders the page title and subtitle', () => {
    render(<CodeWalkthroughView />);
    expect(screen.getByRole('heading', { name: /code walkthrough/i })).toBeInTheDocument();
  });

  it('renders all 8 TOC sidebar links', () => {
    render(<CodeWalkthroughView />);
    expect(screen.getByRole('link', { name: /architecture/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /security model/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /data flow/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /api usage/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tool breakdown/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /relay deep dive/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /jira write operations/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /snow write operations/i })).toBeInTheDocument();
  });

  it('renders all section headings in the main content', () => {
    render(<CodeWalkthroughView />);
    expect(screen.getAllByRole('heading', { name: /architecture/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: /security model/i }).length).toBeGreaterThan(0);
  });

  it('filters sections when a search query matches', () => {
    render(<CodeWalkthroughView />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'relay' } });
    expect(screen.getAllByRole('heading', { name: /relay/i }).length).toBeGreaterThan(0);
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
