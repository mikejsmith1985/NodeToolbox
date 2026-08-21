// FeatureScopePanel.test.tsx — Proves a team can narrow its board to the Features it owns, and that
// the panel is honest about what narrowing costs.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FeatureScopePanel, describeDisciplineProblems, parseLabelList } from './FeatureScopePanel.tsx';
import type { FeatureScopeSettings } from '../featureScope.ts';

const TRANSFORMERS_SCOPE: FeatureScopeSettings = {
  featureProjectKeys: ['ENCUC'],
  shouldIncludeOutOfProjectFeatureLinks: false,
  shouldIncludeIssueLinkedFeatures: false,
  carryOverPiValue: '', carryOverSource: 'none', teamFeatureLabel: '',
  excludedFeatureLabels: [], disciplineProjects: [],
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

describe('parseLabelList', () => {
  it('splits a comma-separated list the way somebody would type it', () => {
    expect(parseLabelList('Backlog, No-Development')).toEqual(['Backlog', 'No-Development']);
  });

  it('accepts spaces as separators too, since a Jira label can never contain one', () => {
    expect(parseLabelList('Backlog No-Development')).toEqual(['Backlog', 'No-Development']);
  });

  it('drops the empty entry a trailing comma leaves behind, which would match nothing', () => {
    expect(parseLabelList('Backlog, ')).toEqual(['Backlog']);
  });

  it('reads an empty box as no exclusions at all', () => {
    expect(parseLabelList('')).toEqual([]);
  });
});

describe('describeDisciplineProblems', () => {
  it('says nothing about a sensible configuration', () => {
    const disciplines = [{ name: 'QE', featureProjectKey: 'QEINT', storyProjectKeys: ['QEINT'] }];

    expect(describeDisciplineProblems(disciplines, ['DENP'])).toBe('');
  });

  it('catches a discipline pointed at the team own Feature project', () => {
    // The setting that would silently do nothing: every clone there is a peer, so the discipline
    // would never match anything, and a setting that quietly does nothing is worse than one that
    // refuses.
    const disciplines = [{ name: 'Oops', featureProjectKey: 'DENP', storyProjectKeys: ['ENCUC'] }];

    expect(describeDisciplineProblems(disciplines, ['DENP'])).toContain('peer Feature');
  });

  it('catches two disciplines naming the same Feature project', () => {
    const disciplines = [
      { name: 'QE', featureProjectKey: 'QEINT', storyProjectKeys: ['QEINT'] },
      { name: 'BT', featureProjectKey: 'QEINT', storyProjectKeys: ['BTINT'] },
    ];

    expect(describeDisciplineProblems(disciplines, ['DENP'])).toContain('indistinguishable');
  });

  it('says nothing about a half-typed row somebody is still filling in', () => {
    const disciplines = [{ name: '', featureProjectKey: '', storyProjectKeys: [] }];

    expect(describeDisciplineProblems(disciplines, ['DENP'])).toBe('');
  });
});

describe('the discipline editor', () => {
  it('keeps a row identified by position, so typing does not throw the input away', () => {
    // The bug: the row key included the project key, so every keystroke changed the key, React
    // remounted the input, and focus jumped to the next control after ONE character.
    const scope = {
      featureProjectKeys: ['DENP'],
      shouldIncludeOutOfProjectFeatureLinks: false,
      shouldIncludeIssueLinkedFeatures: false,
      carryOverPiValue: '',
      carryOverSource: 'none' as const,
      teamFeatureLabel: '',
      excludedFeatureLabels: [],
      disciplineProjects: [{ name: 'QE', featureProjectKey: 'QE', storyProjectKeys: [] }],
    };
    const scopeChanges: unknown[] = [];

    const commonProps = {
      allFeatureKeys: [],
      featureLinkedOutOfProjectKeys: [],
      hasOwnScope: true,
      hiddenIssueCount: 0,
      issueLinkedOutOfProjectKeys: [],
      onResetScope: vi.fn(),
    };

    const { rerender } = render(
      <FeatureScopePanel {...commonProps} onScopeChange={(next) => scopeChanges.push(next)} scope={scope} />,
    );

    const featureProjectInput = screen.getByLabelText('Discipline 1 Feature project');
    featureProjectInput.focus();
    fireEvent.change(featureProjectInput, { target: { value: 'QEI' } });

    // Re-render with the typed value, exactly as the parent would.
    rerender(
      <FeatureScopePanel
        {...commonProps}
        onScopeChange={() => {}}
        scope={{ ...scope, disciplineProjects: [{ name: 'QE', featureProjectKey: 'QEI', storyProjectKeys: [] }] }}
      />,
    );

    // Same element, still focused — not a fresh one that lost the caret.
    expect(screen.getByLabelText('Discipline 1 Feature project')).toBe(featureProjectInput);
    expect(document.activeElement).toBe(featureProjectInput);
  });
});

describe('the cross-project notice says which way round it is', () => {
  /** The same scope with the Feature Link toggle switched on — the state that ADMITS these Features. */
  const ADMITTING_SCOPE: FeatureScopeSettings = {
    ...TRANSFORMERS_SCOPE,
    shouldIncludeOutOfProjectFeatureLinks: true,
  };

  function renderWithScope(scope: FeatureScopeSettings) {
    return render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={['CISMP-1130']}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={scope}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );
  }

  it('says the work is ON the board when the toggle that admits it is on', () => {
    // The whole confusion: the same red line appeared whether the Feature was on the board or kept
    // off it, so it read as an exclusion while it was in fact a list of what the box above let in.
    renderWithScope(ADMITTING_SCOPE);

    expect(screen.getByText(/on this board/i)).toBeTruthy();
    expect(screen.getByText(/CISMP-1130/)).toBeTruthy();
  });

  it('names the toggle to untick, so the fix is in the sentence', () => {
    renderWithScope(ADMITTING_SCOPE);
    expect(screen.getByText(/untick/i)).toBeTruthy();
  });

  it('says the work is kept OFF the board when the toggle is off', () => {
    renderWithScope(TRANSFORMERS_SCOPE);
    expect(screen.getByText(/kept off this board/i)).toBeTruthy();
  });

  it('still says a cross-project Feature Link is worth correcting, either way', () => {
    renderWithScope(ADMITTING_SCOPE);
    expect(screen.getByText(/worth correcting in Jira/)).toBeTruthy();
  });
});

describe('the team label copy does not overstate what the label does', () => {
  it('says the label governs Features with no work under them, not every lane', () => {
    // The old copy read "Only Features carrying CUC count as this team's", which is not what happens:
    // a Feature the board's own work rolls up to gets a lane whatever labels it carries.
    render(
      <FeatureScopePanel
        featureLinkedOutOfProjectKeys={[]}
        hasOwnScope
        hiddenIssueCount={0}
        issueLinkedOutOfProjectKeys={[]}
        onResetScope={vi.fn()}
        onScopeChange={vi.fn()}
        scope={{ ...TRANSFORMERS_SCOPE, teamFeatureLabel: 'CUC' }}
        allFeatureKeys={ALL_FEATURE_KEYS}
      />,
    );

    expect(screen.getByText(/rolls up to it keeps its lane whatever labels it carries/i)).toBeTruthy();
    expect(screen.queryByText(/Only Features carrying/)).toBeNull();
  });
});
