// FeatureScopePanel.test.tsx — Proves a team can narrow its board to the Features it owns, and that
// the panel is honest about what narrowing costs.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FeatureScopePanel } from './FeatureScopePanel.tsx';
import type { FeatureScopeSettings } from '../featureScope.ts';

const TRANSFORMERS_SCOPE: FeatureScopeSettings = {
  featureProjectKeys: ['ENCUC'],
  shouldIncludeOutOfProjectFeatureLinks: false,
  shouldIncludeIssueLinkedFeatures: false,
};

/** Every Feature the board touches, INCLUDING projects the current scope excludes. */
const ALL_FEATURE_KEYS = ['ENCUC-1', 'ENCUC-2', 'DENP-9', 'QEINT-4', '__no_feature__'];

describe('FeatureScopePanel — configuring the projects', () => {
  it('shows the team\'s current project list', () => {
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect((screen.getByLabelText('Feature project keys') as HTMLInputElement).value).toBe('ENCUC');
  });

  it('accepts a two-project list, comma separated', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    fireEvent.change(screen.getByLabelText('Feature project keys'), { target: { value: 'ENCUC, DENP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onScopeChange.mock.calls[0][0].featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('offers every project the board touches, including ones the scope currently excludes', () => {
    // Deriving these from the FILTERED board made them useless: an excluded project's chip vanished,
    // so there was no way left to discover or re-add it.
    render(
      <FeatureScopePanel
        allFeatureKeys={ALL_FEATURE_KEYS}
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
      />,
    );

    expect(screen.getByRole('button', { name: 'QEINT' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DENP' })).toBeTruthy();
  });

  it('takes a project back out when its chip is clicked again', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        allFeatureKeys={ALL_FEATURE_KEYS}
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ENCUC' }));

    expect(onScopeChange.mock.calls[0][0].featureProjectKeys).toEqual([]);
  });

  it('adds a project the board touches, so nobody has to retype a key', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'DENP' }));

    expect(onScopeChange.mock.calls[0][0].featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('never offers the synthetic No Feature lane as a project', () => {
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect(screen.queryByRole('button', { name: '__NO_FEATURE__' })).toBeNull();
  });

  it('says when the team is inheriting rather than using its own list', () => {
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope={false}
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect(screen.getByText(/using the ART-wide list/)).toBeTruthy();
    // Nothing to reset to while inheriting.
    expect(screen.queryByRole('button', { name: 'Use the ART-wide list' })).toBeNull();
  });

  it('offers a way back to the ART-wide list once the team has its own', () => {
    const onResetScope = vi.fn();
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={onResetScope}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use the ART-wide list' }));

    expect(onResetScope).toHaveBeenCalled();
  });
});

describe('FeatureScopePanel — being honest about what is hidden', () => {
  it('says how many issues the current scope is holding back', () => {
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={8}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect(screen.getByText(/8 issues are hidden by this scope/)).toBeTruthy();
  });

  it('names a cross-project Feature Link even while its work is hidden', () => {
    // Hiding the lane is right; hiding the FACT is not — a Feature Link across projects is a mistake.
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={['PORTFOLIO-12', 'ABC-4']}
        hasOwnScope
        hiddenIssueCount={5}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect(screen.getByText(/PORTFOLIO-12, ABC-4/)).toBeTruthy();
    expect(screen.getByText(/usually worth correcting in Jira/)).toBeTruthy();
  });

  it('offers both toggles, each off by default so the project list actually narrows the board', () => {
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    const toggles = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => !toggle.checked)).toBe(true);
  });

  it('reveals Feature-Linked out-of-project work without touching the issue-link toggle', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={['PORTFOLIO-12']}
        hasOwnScope
        hiddenIssueCount={5}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    const [nextScope] = onScopeChange.mock.calls[0];
    expect(nextScope.shouldIncludeOutOfProjectFeatureLinks).toBe(true);
    expect(nextScope.shouldIncludeIssueLinkedFeatures).toBe(false);
  });

  it('reveals issue-linked out-of-project work without touching the Feature Link toggle', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={5}
        issueLinkedOutOfProjectKeys={['OTHER-9']}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[1]);

    const [nextScope] = onScopeChange.mock.calls[0];
    expect(nextScope.shouldIncludeIssueLinkedFeatures).toBe(true);
    expect(nextScope.shouldIncludeOutOfProjectFeatureLinks).toBe(false);
  });

  it('says nothing about hidden issues when the scope is holding nothing back', () => {
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect(screen.queryByText(/hidden by this scope/)).toBeNull();
  });
});
