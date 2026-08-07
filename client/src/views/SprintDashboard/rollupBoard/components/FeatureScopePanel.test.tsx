// FeatureScopePanel.test.tsx — Proves a team can narrow its board to the Features it owns, and that
// the panel is honest about what narrowing costs.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FeatureScopePanel } from './FeatureScopePanel.tsx';
import type { FeatureScopeSettings } from '../featureScope.ts';

const TRANSFORMERS_SCOPE: FeatureScopeSettings = {
  featureProjectKeys: ['ENCUC'],
  shouldIncludeIssueLinkedFeatures: false,
};

const VISIBLE_FEATURE_KEYS = ['ENCUC-1', 'ENCUC-2', 'DENP-9', '__no_feature__'];

describe('FeatureScopePanel — configuring the projects', () => {
  it('shows the team\'s current project list', () => {
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={0}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    expect((screen.getByLabelText('Feature project keys') as HTMLInputElement).value).toBe('ENCUC');
  });

  it('accepts a two-project list, comma separated', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={0}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    fireEvent.change(screen.getByLabelText('Feature project keys'), { target: { value: 'ENCUC, DENP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onScopeChange.mock.calls[0][0].featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('offers the projects already on the board, so nobody has to retype a key', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={0}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'DENP' }));

    expect(onScopeChange.mock.calls[0][0].featureProjectKeys).toEqual(['ENCUC', 'DENP']);
  });

  it('never offers the synthetic No Feature lane as a project', () => {
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={0}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    expect(screen.queryByRole('button', { name: '__NO_FEATURE__' })).toBeNull();
  });

  it('says when the team is inheriting rather than using its own list', () => {
    render(
      <FeatureScopePanel
        hasOwnScope={false}
        hiddenIssueCount={0}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
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
        hasOwnScope
        hiddenIssueCount={0}
        onResetScope={onResetScope}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
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
        hasOwnScope
        hiddenIssueCount={8}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    expect(screen.getByText(/8 issues are hidden right now/)).toBeTruthy();
  });

  it('stops mentioning hidden issues once the toggle reveals them', () => {
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={8}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={{ ...TRANSFORMERS_SCOPE, shouldIncludeIssueLinkedFeatures: true }}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    expect(screen.queryByText(/hidden right now/)).toBeNull();
  });

  it('lets the viewer reveal loosely-linked Features from other projects', () => {
    const onScopeChange = vi.fn();
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={8}
        onResetScope={vi.fn()}
        onScopeChange={onScopeChange}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onScopeChange.mock.calls[0][0].shouldIncludeIssueLinkedFeatures).toBe(true);
  });

  it('states that Feature Link work is never hidden, whatever the project', () => {
    render(
      <FeatureScopePanel
        hasOwnScope
        hiddenIssueCount={0}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={TRANSFORMERS_SCOPE}
        visibleFeatureKeys={VISIBLE_FEATURE_KEYS}
      />,
    );

    expect(screen.getByText(/is always shown, even if its Feature sits outside/)).toBeTruthy();
  });
});
