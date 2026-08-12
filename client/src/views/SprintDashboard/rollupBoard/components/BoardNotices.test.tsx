// BoardNotices.test.tsx — Proves the board's messages cost one line until asked for.
//
// Each message earned its place, but nine stacked boxes pushed the board off the screen and buried
// anything rendered among them — which is how the add-work dialog came to look like a dead button.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BoardNotices, describeNoticeCount, type BoardNotice } from './BoardNotices.tsx';

const NOTICES: BoardNotice[] = [
  { id: 'a', tone: 'warning', summary: '3 issues are hidden because their Features are outside…' },
  { id: 'b', tone: 'info', summary: 'This board holds more than 300 issues.' },
];

describe('describeNoticeCount — a status, not an alarm', () => {
  it('separates what needs attention from what is merely context', () => {
    // "6 notices" reads as an alarm; most notices are context.
    expect(describeNoticeCount(NOTICES)).toBe('2 board notices · 1 needs attention');
  });

  it('says nothing about attention when everything is informational', () => {
    expect(describeNoticeCount([NOTICES[1]])).toBe('1 board notice');
  });

  it('pluralises the attention count', () => {
    const twoWarnings = [NOTICES[0], { ...NOTICES[0], id: 'c' }];
    expect(describeNoticeCount(twoWarnings)).toContain('2 need attention');
  });
});

describe('BoardNotices', () => {
  it('starts collapsed, so a read notice costs one line', () => {
    render(<BoardNotices notices={NOTICES} />);

    expect(screen.getByText(/2 board notices/)).toBeInTheDocument();
    expect(screen.queryByText(/3 issues are hidden/)).not.toBeInTheDocument();
  });

  it('opens for the detail', () => {
    render(<BoardNotices notices={NOTICES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));

    expect(screen.getByText(/3 issues are hidden/)).toBeInTheDocument();
    expect(screen.getByText(/more than 300 issues/)).toBeInTheDocument();
  });

  it('collapses again', () => {
    render(<BoardNotices notices={NOTICES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));

    expect(screen.queryByText(/3 issues are hidden/)).not.toBeInTheDocument();
  });

  it('can be dismissed entirely', () => {
    render(<BoardNotices notices={NOTICES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('rollup-board-notices')).not.toBeInTheDocument();
  });

  it('renders nothing at all when the board has nothing to say', () => {
    render(<BoardNotices notices={[]} />);
    expect(screen.queryByTestId('rollup-board-notices')).not.toBeInTheDocument();
  });

  it('can be asked to open expanded, for something that blocks the board', () => {
    render(<BoardNotices notices={NOTICES} shouldStartExpanded />);
    expect(screen.getByText(/3 issues are hidden/)).toBeInTheDocument();
  });

  it('marks the panel as a warning when any notice is one', () => {
    render(<BoardNotices notices={NOTICES} />);
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });

  it('marks it informational when none is', () => {
    render(<BoardNotices notices={[NOTICES[1]]} />);
    expect(screen.getByText(/ℹ/)).toBeInTheDocument();
  });
});
