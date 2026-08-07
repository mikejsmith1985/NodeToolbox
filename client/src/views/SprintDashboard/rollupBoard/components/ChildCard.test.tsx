// ChildCard.test.tsx — Proves a card says what it is without relying on its colour, and always
// explains how it got into the lane it is in.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChildCard, describeRollUpRoute } from './ChildCard.tsx';
import type { IssueTypeBucket, RollupBoardItem } from '../rollupBoardTypes.ts';
import type { JiraIssue } from '../../../../types/jira.ts';

function buildItem(overrides: Partial<RollupBoardItem> = {}): RollupBoardItem {
  return {
    issue: { id: 'DEV-1', key: 'DEV-1', fields: { summary: 'DEV-1' } } as unknown as JiraIssue,
    key: 'DEV-1',
    summary: 'Add the eligibility rule',
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: {
      steps: [{ kind: 'featureLink', fieldId: 'customfield_10108', toKey: 'FEAT-1' }],
      featureKey: 'FEAT-1',
      precedenceRank: null,
      unchosenCandidates: [],
      notes: [],
    },
    featureKey: 'FEAT-1',
    columnId: 'col-todo',
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints: null,
    checklistCompletion: null,
    ...overrides,
  };
}

describe('ChildCard — type is never carried by colour alone', () => {
  const typeCases: Array<{ bucket: IssueTypeBucket; typeName: string }> = [
    { bucket: 'story', typeName: 'Story' },
    { bucket: 'defect', typeName: 'Defect' },
    { bucket: 'subtask', typeName: 'Sub-task' },
    { bucket: 'other', typeName: 'Spike' },
  ];

  it.each(typeCases)('states the type of a $bucket card in text as well as colour', ({ bucket, typeName }) => {
    render(<ChildCard item={buildItem({ typeBucket: bucket, typeName })} />);

    // The colour class exists for quick scanning...
    expect(screen.getByTestId('rollup-card-DEV-1').dataset.typeBucket).toBe(bucket);
    // ...but the type is also readable, which is what survives greyscale or colour blindness.
    expect(screen.getByText(typeName)).toBeTruthy();
  });
});

describe('ChildCard — content', () => {
  it('shows the issue key and summary', () => {
    render(<ChildCard item={buildItem()} />);

    expect(screen.getByText('DEV-1')).toBeTruthy();
    expect(screen.getByText('Add the eligibility rule')).toBeTruthy();
  });

  it('shows a sub-status beside the status, since together they are the real state', () => {
    render(<ChildCard item={buildItem({ statusName: 'In Progress', subStatusValue: 'Dev Complete' })} />);

    expect(screen.getByText('Dev Complete')).toBeTruthy();
  });

  it('omits story points entirely when there is no estimate, rather than showing zero', () => {
    render(<ChildCard item={buildItem({ storyPoints: null })} />);

    expect(screen.queryByText(/pts/)).toBeNull();
  });

  it('shows checklist progress only when the issue actually carries checklist data', () => {
    const { rerender } = render(<ChildCard item={buildItem()} />);
    expect(screen.queryByText(/Checklist/)).toBeNull();

    rerender(<ChildCard item={buildItem({ checklistCompletion: { completedCount: 2, totalCount: 5 } })} />);
    expect(screen.getByText('Checklist 2/5')).toBeTruthy();
  });

  it('names the relationships the precedence chain did not take, so none is silently lost', () => {
    render(<ChildCard item={buildItem({
      route: {
        steps: [{ kind: 'issueLink', linkTypeName: 'Relates', toKey: 'DEV-9' }],
        featureKey: 'FEAT-1',
        precedenceRank: 'dev-story',
        unchosenCandidates: [{ toKey: 'QA-1', viaLinkTypeName: 'Relates', resolvedFeatureKey: 'FEAT-2' }],
        notes: [],
      },
    })} />);

    expect(screen.getByText(/Also linked to QA-1/)).toBeTruthy();
  });

  it('flags a circular link set as something to tidy rather than failing silently', () => {
    render(<ChildCard item={buildItem({
      route: { steps: [], featureKey: null, precedenceRank: null, unchosenCandidates: [], notes: ['link-loop-detected'] },
    })} />);

    expect(screen.getByText(/links form a loop/)).toBeTruthy();
  });

  it('shows the reason in place when the last action on this card failed', () => {
    render(<ChildCard errorMessage="Jira rejected the transition" item={buildItem()} />);

    expect(screen.getByText('Jira rejected the transition')).toBeTruthy();
  });
});

describe('describeRollUpRoute', () => {
  it('says plainly when an issue rolls up to nothing', () => {
    expect(describeRollUpRoute({
      steps: [], featureKey: null, precedenceRank: null, unchosenCandidates: [], notes: [],
    })).toBe('Does not roll up to any Feature');
  });

  it('names the intermediate issue a defect travelled through', () => {
    const description = describeRollUpRoute({
      steps: [
        { kind: 'issueLink', linkTypeName: 'Relates', toKey: 'QA-1' },
        { kind: 'issueLink', linkTypeName: 'Relates', toKey: 'DEV-1' },
        { kind: 'featureLink', fieldId: 'customfield_10108', toKey: 'FEAT-1' },
      ],
      featureKey: 'FEAT-1',
      precedenceRank: 'via-qa-issue',
      unchosenCandidates: [],
      notes: [],
    });

    expect(description).toContain('QA-1');
    expect(description).toContain('DEV-1');
  });

  it('says a sub-task reached its Feature through its parent', () => {
    const description = describeRollUpRoute({
      steps: [
        { kind: 'parent', toKey: 'DEV-1' },
        { kind: 'featureLink', fieldId: 'customfield_10108', toKey: 'FEAT-1' },
      ],
      featureKey: 'FEAT-1',
      precedenceRank: null,
      unchosenCandidates: [],
      notes: [],
    });

    expect(description).toContain('parent DEV-1');
  });
});
