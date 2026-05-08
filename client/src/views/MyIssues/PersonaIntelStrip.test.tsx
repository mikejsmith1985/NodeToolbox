// PersonaIntelStrip.test.tsx — Tests for the Persona Intel Strip component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ExtendedJiraIssue } from './myIssuesExtendedTypes.ts';
import PersonaIntelStrip from './PersonaIntelStrip.tsx';

// ── Test fixtures ──

function createTestIssue(overrides: Partial<ExtendedJiraIssue['fields']> = {}): ExtendedJiraIssue {
  return {
    id: 'test-1',
    key: 'TBX-1',
    fields: {
      summary: 'Test issue',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium', iconUrl: '' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: null,
      ...overrides,
    },
  };
}

const MOCK_ISSUES: ExtendedJiraIssue[] = [
  createTestIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } }),
  createTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
  createTestIssue({ status: { name: 'In Review', statusCategory: { key: 'indeterminate' } } }),
  createTestIssue({ status: { name: 'To Do', statusCategory: { key: 'new' } } }),
  createTestIssue({ issuetype: { name: 'Bug', iconUrl: '' } }),
];

describe('PersonaIntelStrip', () => {
  it('renders nothing when issues array is empty', () => {
    const { container } = render(
      <PersonaIntelStrip
        activeStatusZone={null}
        issues={[]}
        onZoneClick={vi.fn()}
        persona="dev"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders dev persona chips when persona is dev', () => {
    render(
      <PersonaIntelStrip
        activeStatusZone={null}
        issues={MOCK_ISSUES}
        onZoneClick={vi.fn()}
        persona="dev"
      />,
    );

    // Dev persona shows Needs Attention count
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it('renders QA persona chips when persona is qa', () => {
    const bugIssue = createTestIssue({ issuetype: { name: 'Bug', iconUrl: '' } });
    render(
      <PersonaIntelStrip
        activeStatusZone={null}
        issues={[bugIssue]}
        onZoneClick={vi.fn()}
        persona="qa"
      />,
    );

    expect(screen.getByText(/bug/i)).toBeInTheDocument();
  });

  it('renders SM persona chips when persona is sm', () => {
    const blockedIssue = createTestIssue({
      status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
    });
    render(
      <PersonaIntelStrip
        activeStatusZone={null}
        issues={[blockedIssue]}
        onZoneClick={vi.fn()}
        persona="sm"
      />,
    );

    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it('renders PO persona chips when persona is po', () => {
    const unestimatedIssue = createTestIssue({ customfield_10016: null });
    render(
      <PersonaIntelStrip
        activeStatusZone={null}
        issues={[unestimatedIssue]}
        onZoneClick={vi.fn()}
        persona="po"
      />,
    );

    // PO shows total count at minimum
    expect(screen.getByText(/total/i)).toBeInTheDocument();
  });

  it('calls onZoneClick with attention zone when Needs Attention chip is clicked', async () => {
    const user = userEvent.setup();
    const handleZoneClick = vi.fn();
    const blockedIssue = createTestIssue({
      status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
    });

    render(
      <PersonaIntelStrip
        activeStatusZone={null}
        issues={[blockedIssue]}
        onZoneClick={handleZoneClick}
        persona="dev"
      />,
    );

    await user.click(screen.getByText(/needs attention/i));

    expect(handleZoneClick).toHaveBeenCalledWith('attention');
  });

  it('calls onZoneClick with null when active chip is clicked again (toggle off)', async () => {
    const user = userEvent.setup();
    const handleZoneClick = vi.fn();
    const blockedIssue = createTestIssue({
      status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
    });

    render(
      <PersonaIntelStrip
        activeStatusZone="attention"
        issues={[blockedIssue]}
        onZoneClick={handleZoneClick}
        persona="dev"
      />,
    );

    await user.click(screen.getByText(/needs attention/i));

    expect(handleZoneClick).toHaveBeenCalledWith(null);
  });
});
