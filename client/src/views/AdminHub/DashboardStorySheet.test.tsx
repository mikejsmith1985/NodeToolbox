// DashboardStorySheet.test.tsx — Proves the build sheet lists the dashboard's steps with live counts and the supply verdict.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardStorySheet } from './DashboardStorySheet.tsx';

const COUNTS = new Map<string, number | null>([
  ['Epics', 40], ['Team Work', 300], ['Done 30 Days', 30], ['In Progress', 25], ['Flagged', 2], ['Stuck 10 Days', 9],
  ['Unassigned In Progress', 1], ['Ready to Work', 10], ['Ready but Unestimated', 3], ['Defects', 50], ['Open Defects', 12],
]);

describe('DashboardStorySheet', () => {
  it('shows the controller first, then each question with its gadget, settings and clause counts', () => {
    render(<DashboardStorySheet clauseCounts={COUNTS} readySupply={null} />);
    expect(screen.getByText(/Rich Filter Controller/)).toBeInTheDocument();
    expect(screen.getByText('6 · Is there enough Ready to Work?')).toBeInTheDocument();
    expect(screen.getByText('Ready but Unestimated: 3')).toBeInTheDocument();
  });

  it('puts the weeks-of-supply verdict under the Ready to Work step', () => {
    render(<DashboardStorySheet clauseCounts={COUNTS} readySupply={{ weeklyThroughput: 7, weeksOfSupply: 1.4, verdict: 'healthy', message: '1.4 weeks of Ready to Work — healthy.' }} />);
    expect(screen.getByText(/1\.4 weeks of Ready to Work — healthy\./)).toBeInTheDocument();
  });

  it('says which clauses a step is missing instead of showing a blank', () => {
    render(<DashboardStorySheet clauseCounts={new Map([['Team Work', 300]])} readySupply={null} />);
    expect(screen.getAllByText(/Not available on this Jira: Ready to Work, Ready but Unestimated/).length).toBe(1);
  });
});
