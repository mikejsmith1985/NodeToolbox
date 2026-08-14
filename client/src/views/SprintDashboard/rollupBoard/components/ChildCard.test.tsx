// ChildCard.test.tsx — Proves a card says what it is without relying on its colour, and always
// explains how it got into the lane it is in.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    checklistItems: [],
    isFlagged: false,
    impedimentReasons: [],
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

describe('the detailed card shown while a column is focused', () => {
  const DETAIL = {
    descriptionExcerpt: 'Rework the intake so a duplicate pull cannot post twice.',
    attachmentCount: 3,
    lastComment: {
      authorDisplayName: 'Smith, Mike (CTR)',
      createdAt: '2026-08-01T10:00:00.000+0000',
      excerpt: 'Deployed to the test environment, ready for a look.',
    },
  };

  it('shows nothing extra on the normal board, so a dozen columns stay readable', () => {
    render(<ChildCard item={buildItem()} />);

    expect(screen.queryByText(/attachment/)).toBeNull();
  });

  it('shows the description, the attachment count, and the last comment when focused', () => {
    render(<ChildCard detail={DETAIL} item={buildItem()} />);

    expect(screen.getByText(/Rework the intake/)).toBeTruthy();
    expect(screen.getByText(/3 attachments/)).toBeTruthy();
    expect(screen.getByText(/Smith, Mike \(CTR\)/)).toBeTruthy();
    expect(screen.getByText(/ready for a look/)).toBeTruthy();
  });

  it('omits each part the issue does not have rather than showing an empty row', () => {
    render(<ChildCard detail={{ descriptionExcerpt: null, attachmentCount: 0, lastComment: null }} item={buildItem()} />);

    expect(screen.queryByText(/attachment/)).toBeNull();
  });
});

describe('the status shown on an Unmapped card', () => {
  it('says nothing extra in a normal column, where the column IS the status', () => {
    render(<ChildCard item={buildItem({ statusName: 'In Progress', subStatusValue: 'Code Review' })} />);

    expect(screen.queryByText('In Progress / Code Review')).toBeNull();
  });

  it('names both halves in Unmapped, since a card can be unmapped on the sub-status alone', () => {
    render(
      <ChildCard
        item={buildItem({ statusName: 'In Progress', subStatusValue: 'Code Review' })}
        shouldShowStatus
      />,
    );

    expect(screen.getByText('In Progress / Code Review')).toBeTruthy();
  });

  it('names just the status when the issue has no sub-status', () => {
    render(<ChildCard item={buildItem({ statusName: 'Triage', subStatusValue: null })} shouldShowStatus />);

    expect(screen.getByText('Triage')).toBeTruthy();
  });
});

describe('a card in another discipline band', () => {
  it('behaves exactly as before when it is not read-only', () => {
    // R-01: making sub-lanes read-only must not change how the primary lane feels.
    render(<ChildCard item={buildItem()} />);

    expect(screen.getByTestId('rollup-card-DEV-1').hasAttribute('aria-roledescription')).toBe(true);
  });

  it('advertises nothing draggable when read-only', () => {
    // R-02: the hook's `disabled` stops the drag, but its attributes would still tell assistive
    // technology this is a draggable element — so the listeners AND attributes are withheld.
    render(<ChildCard isReadOnly item={buildItem()} />);

    const card = screen.getByTestId('rollup-card-DEV-1');
    expect(card.hasAttribute('aria-roledescription')).toBe(false);
    expect(card.getAttribute('draggable')).not.toBe('true');
  });

  it('still opens its detail when clicked, because read-only means immovable, not inert', () => {
    const opened: string[] = [];
    render(<ChildCard isReadOnly item={buildItem()} onOpen={(key) => opened.push(key)} />);

    fireEvent.click(screen.getByTestId('rollup-card-DEV-1'));

    expect(opened).toEqual(['DEV-1']);
  });
});

describe('checklist items nested inside the card', () => {
  it('draws nothing when the issue has no checklist', () => {
    render(<ChildCard item={buildItem()} />);

    expect(screen.queryByText(/this is a test/)).toBeNull();
  });

  it('draws each item as its own nested row under the story it belongs to', () => {
    render(<ChildCard item={buildItem({
      checklistItems: [
        { id: 'checklist-0', text: 'this is a test', state: 'open', assigneeUserId: 'C8Q6T3', headingText: null },
        { id: 'checklist-1', text: 'and another', state: 'done', assigneeUserId: null, headingText: null },
      ],
    })} />);

    expect(screen.getByText('this is a test')).toBeTruthy();
    expect(screen.getByText('and another')).toBeTruthy();
  });

  it('names the person an item is assigned to', () => {
    render(<ChildCard item={buildItem({
      checklistItems: [
        { id: 'checklist-0', text: 'review', state: 'open', assigneeUserId: 'jsmith', headingText: null },
      ],
    })} />);

    expect(screen.getByText('@jsmith')).toBeTruthy();
  });

  it('marks the state as data, so a finished item does not rely on colour alone', () => {
    const { container } = render(<ChildCard item={buildItem({
      checklistItems: [
        { id: 'checklist-0', text: 'done thing', state: 'done', assigneeUserId: null, headingText: null },
      ],
    })} />);

    expect(container.querySelector('[data-state="done"]')).toBeTruthy();
  });
});

describe('ChildCard — containment is asked for, never dropped into', () => {
  const SIBLINGS = [
    { key: 'DEV-1', summary: 'The card itself' },
    { key: 'DEV-2', summary: 'A sibling in the same column' },
  ];

  it('offers each sibling as a container, naming what the link will say', () => {
    render(
      <ChildCard
        containerCandidates={SIBLINGS}
        item={buildItem()}
        onNestInto={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.getByRole('menuitem', { name: /Contain within DEV-2/ })).toBeTruthy();
  });

  it('never offers the card as a container of itself', () => {
    render(
      <ChildCard containerCandidates={SIBLINGS} item={buildItem()} onNestInto={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.queryByRole('menuitem', { name: /Contain within DEV-1/ })).toBeNull();
  });

  it('records the containment the menu named', () => {
    const onNestInto = vi.fn();
    render(<ChildCard containerCandidates={SIBLINGS} item={buildItem()} onNestInto={onNestInto} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Contain within DEV-2/ }));

    expect(onNestInto).toHaveBeenCalledWith('DEV-1', 'DEV-2');
  });

  it('offers no menu on a read-only card, which the board has no business writing', () => {
    render(
      <ChildCard containerCandidates={SIBLINGS} isReadOnly item={buildItem()} onNestInto={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers no menu when this card has no siblings to be contained in', () => {
    render(
      <ChildCard containerCandidates={[{ key: 'DEV-1', summary: 'Alone' }]} item={buildItem()} onNestInto={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('ChildCard — a blocked card says so', () => {
  it('marks a flagged issue in words as well as colour', () => {
    // The Feature's own flag has always shown in the lane header; the work under it had no marker at
    // all, so a blocked Story sat in its column looking exactly like a moving one.
    render(<ChildCard item={buildItem({ isFlagged: true, impedimentReasons: ['Flagged'] })} />);

    expect(screen.getByText('Flagged')).toBeTruthy();
  });

  it('names a blocking LINK as a link, never as a flag', () => {
    // The bug this pins: every impediment was called "Flagged", so a card blocked by a link offered
    // to remove a flag it never had — and removing it changed nothing, because there was none.
    render(<ChildCard item={buildItem({ isFlagged: false, impedimentReasons: ['Blocked Link'] })} />);

    expect(screen.getByText('Blocked by a link')).toBeTruthy();
    expect(screen.queryByText(/Flagged/)).toBeNull();
  });

  it('shows every reason it is impeded, since they are undone in different places', () => {
    render(<ChildCard item={buildItem({
      isFlagged: true, impedimentReasons: ['Flagged', 'Blocked Status'],
    })} />);

    expect(screen.getByText('Flagged')).toBeTruthy();
    expect(screen.getByText('Blocked status')).toBeTruthy();
  });

  it('says nothing at all when the issue is not impeded', () => {
    render(<ChildCard item={buildItem({ isFlagged: false })} />);

    expect(screen.queryByText(/Flagged|Blocked/)).toBeNull();
  });
});

describe('ChildCard — raising and clearing the flag', () => {
  it('offers to flag an unflagged card, naming what it will do', () => {
    render(<ChildCard item={buildItem({ isFlagged: false })} onToggleFlag={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.getByRole('menuitem', { name: 'Flag as an impediment in Jira' })).toBeTruthy();
  });

  it('offers to remove the flag from a flagged card', () => {
    render(<ChildCard item={buildItem({ isFlagged: true })} onToggleFlag={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.getByRole('menuitem', { name: 'Remove the flag in Jira' })).toBeTruthy();
  });

  it('asks for the OPPOSITE of the state it is in, so the entry cannot lie', () => {
    const onToggleFlag = vi.fn();
    render(<ChildCard item={buildItem({ isFlagged: true })} onToggleFlag={onToggleFlag} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove the flag in Jira' }));

    expect(onToggleFlag).toHaveBeenCalledWith('DEV-1', false);
  });

  it('never offers it on a read-only card, whose workflow the board does not own', () => {
    render(<ChildCard isReadOnly item={buildItem({ isFlagged: false })} onToggleFlag={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1'));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
