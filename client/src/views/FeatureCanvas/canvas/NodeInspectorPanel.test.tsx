// NodeInspectorPanel.test.tsx — Verifies the read-only inspector shows epic detail, description,
// attachments, comments, and child records without exposing any editable control.

import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { NodeInspectorPanel } from './NodeInspectorPanel.tsx';

// The inspector loads comments on demand via the shared hook; stub it so the panel renders a fixed
// thread without any network access.
const mockUseIssueComments = vi.fn();
vi.mock('../../../hooks/useIssueComments.ts', () => ({
  useIssueComments: (issueKey: string) => mockUseIssueComments(issueKey),
}));

function setComments(comments: Array<{ id: string; author?: { displayName?: string }; body?: unknown; created?: string }>): void {
  mockUseIssueComments.mockReturnValue({ comments, isLoading: false, loadError: null, refresh: vi.fn() });
}

function buildNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    issueKey: 'ENFCT-1', position: { x: 0, y: 0 }, size: 'L', priority: 'Must', containerId: null,
    isExpanded: false, isParked: false, summary: 'Login redesign', status: 'In Progress',
    statusCategoryKey: 'indeterminate', assignee: 'Ada', storyPoints: 5,
    businessValue: 8, description: 'The epic goal in prose.', acceptanceCriteria: null, parkReason: null, storyPlacements: {}, pendingComment: "",
    health: 'yellow', completionPercent: 40,
    hygieneFlags: [], dependencies: [],
    attachments: [
      { id: '900', filename: 'spec.pdf', sizeBytes: 2048, contentUrl: 'https://jira/secure/attachment/900/spec.pdf', mimeType: 'application/pdf', author: 'Grace', created: null },
    ],
    childStories: [
      { key: 'ENFCT-2', summary: 'Build form', status: 'Done', statusCategoryKey: 'done', storyPoints: 3 },
      { key: 'ENFCT-3', summary: 'Wire API', status: 'To Do', statusCategoryKey: 'new', storyPoints: null },
    ],
    effectivePoints: 5, ...overrides,
  };
}

function renderInspector(node: CanvasNode | null, onClose = vi.fn()) {
  render(<NodeInspectorPanel {...({ node, onClose } as ComponentProps<typeof NodeInspectorPanel>)} />);
  return { onClose };
}

describe('NodeInspectorPanel', () => {
  it('renders nothing when no node is selected', () => {
    setComments([]);
    const { container } = render(<NodeInspectorPanel node={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the epic detail and its child records (read-only)', () => {
    setComments([]);
    renderInspector(buildNode());
    expect(screen.getByText('ENFCT-1')).toBeInTheDocument();
    expect(screen.getByText('Login redesign')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText(/Child records \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/ENFCT-2 — Build form · Done · 3pt/)).toBeInTheDocument();
    expect(screen.getByText(/ENFCT-3 — Wire API · To Do · —/)).toBeInTheDocument();
    // Read-only: no editable inputs.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows description, acceptance criteria, business value, and attachment download links', () => {
    setComments([]);
    renderInspector(buildNode({ acceptanceCriteria: 'Given SSO, when a member logs in, then a session starts.' }));
    expect(screen.getByText('The epic goal in prose.')).toBeInTheDocument();
    expect(screen.getByText('Acceptance criteria')).toBeInTheDocument();
    expect(screen.getByText('Given SSO, when a member logs in, then a session starts.')).toBeInTheDocument();
    expect(screen.getByText('Business value')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(/Attachments \(1\)/)).toBeInTheDocument();
    const attachmentLink = screen.getByRole('link', { name: 'spec.pdf' });
    expect(attachmentLink).toHaveAttribute('href', 'https://jira/secure/attachment/900/spec.pdf');
  });

  it('renders the loaded comment thread', () => {
    setComments([{ id: 'c1', author: { displayName: 'Grace Hopper' }, body: 'Looks good to me.', created: '2026-02-01T00:00:00.000+0000' }]);
    renderInspector(buildNode());
    expect(screen.getByText(/Comments \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Looks good to me.')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('shows empty-state notes when there is no description or attachments', () => {
    setComments([]);
    renderInspector(buildNode({ description: null, acceptanceCriteria: null, attachments: [] }));
    expect(screen.getByText('No description.')).toBeInTheDocument();
    expect(screen.getByText('No acceptance criteria.')).toBeInTheDocument();
    expect(screen.getByText('No attachments.')).toBeInTheDocument();
    expect(screen.getByText(/Attachments \(0\)/)).toBeInTheDocument();
  });

  it('closes via the close control', () => {
    setComments([]);
    const { onClose } = renderInspector(buildNode());
    fireEvent.click(screen.getByRole('button', { name: /Close inspector/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lets you change MoSCoW priority and size from the inspector (any stage)', () => {
    setComments([]);
    const onSetPriority = vi.fn();
    const onSetSize = vi.fn();
    render(<NodeInspectorPanel node={buildNode()} onClose={vi.fn()} onSetPriority={onSetPriority} onSetSize={onSetSize} />);

    fireEvent.click(screen.getByRole('button', { name: 'Should' }));
    expect(onSetPriority).toHaveBeenCalledWith('ENFCT-1', 'Should');

    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    expect(onSetSize).toHaveBeenCalledWith('ENFCT-1', 'M');
  });

  it('lets you draft a comment from the canvas (posts to Jira on commit)', () => {
    setComments([]);
    const onSetComment = vi.fn();
    render(<NodeInspectorPanel node={buildNode()} onClose={vi.fn()} onSetComment={onSetComment} />);
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Ready for review' } });
    expect(onSetComment).toHaveBeenCalledWith('ENFCT-1', 'Ready for review');
  });
});
