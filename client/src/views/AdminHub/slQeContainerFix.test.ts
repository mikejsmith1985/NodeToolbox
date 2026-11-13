// slQeContainerFix.test.ts — Unit tests for the pure #508 SL/QE container-fix planner.

import { describe, it, expect } from 'vitest';

import {
  WORK_LIST,
  bucketForStatus,
  decideAction,
  resolveContainerLinkType,
  planLinkFlip,
  findTransitionMatching,
  describeAction,
  type ContainerLinkType,
  type IssueLinkShape,
} from './slQeContainerFix.ts';

describe('bucketForStatus', () => {
  it('maps done-like statuses to done', () => {
    ['Done', 'Closed', 'Cancelled', 'Accepted', 'Ready to Accept'].forEach((status) => {
      expect(bucketForStatus(status)).toBe('done');
    });
  });

  it('maps testing-waiting statuses to test', () => {
    expect(bucketForStatus('Ready to Test')).toBe('test');
    expect(bucketForStatus('Ready for QA')).toBe('test');
  });

  it('maps in-flight statuses to active', () => {
    ['To Do', 'Working', 'Ready to Work'].forEach((status) => {
      expect(bucketForStatus(status)).toBe('active');
    });
  });

  it('defaults an unknown status to active, never done', () => {
    expect(bucketForStatus('Something New')).toBe('active');
    expect(bucketForStatus('')).toBe('active');
  });
});

describe('decideAction', () => {
  it('cancels only when every dev story is done', () => {
    expect(decideAction(['Accepted'])).toBe('cancel');
    expect(decideAction(['Cancelled', 'Accepted'])).toBe('cancel');
  });

  it('flips+clones when any dev story is still active', () => {
    expect(decideAction(['To Do'])).toBe('flip-clone');
    expect(decideAction(['Working'])).toBe('flip-clone');
    // mixed active + done is still needed -> flip, not cancel
    expect(decideAction(['Working', 'Accepted'])).toBe('flip-clone');
  });

  it('moves to ready-to-work when a dev story awaits testing', () => {
    expect(decideAction(['Ready to Test'])).toBe('ready-to-work');
  });

  it('reproduces the issue #508 tally: 12 flip-clone, 16 cancel', () => {
    const liveStatus: Record<string, string> = {
      'ENFCT-1214': 'To Do', 'ENFCT-1255': 'Accepted', 'ENFCT-1463': 'Ready to Accept',
      'ENFCT-1531': 'Working', 'ENFCT-1537': 'Working', 'ENFCT-1665': 'To Do',
      'ENFCT-1714': 'Working', 'ENFCT-1752': 'Ready to Work', 'ENFCT-1776': 'Accepted',
      'ENFCT-1779': 'Accepted', 'ENFCT-1786': 'Cancelled', 'ENFCT-1790': 'Accepted',
      'ENFCT-1983': 'Cancelled', 'ENFCT-1984': 'Accepted', 'ENFCT-1989': 'Cancelled',
      'ENFCT-2011': 'To Do', 'ENFCT-2095': 'Accepted', 'ENFCT-2096': 'Accepted',
      'ENFCT-2172': 'Cancelled', 'ENFCT-2175': 'Cancelled', 'ENFCT-2110': 'Working',
      'ENFCT-2129': 'To Do', 'ENFCT-2133': 'To Do', 'ENFCT-2148': 'To Do', 'ENFCT-2191': 'To Do',
    };
    const tally = { 'flip-clone': 0, cancel: 0, 'ready-to-work': 0, skip: 0 };
    for (const entry of WORK_LIST) {
      if (entry.skip) { tally.skip += 1; continue; }
      const action = decideAction(entry.devs.map((key) => liveStatus[key]));
      tally[action] += 1;
    }
    expect(tally).toEqual({ 'flip-clone': 12, cancel: 16, 'ready-to-work': 0, skip: 1 });
  });
});

describe('resolveContainerLinkType', () => {
  it('finds Container and places the dev on the outward (contains) side', () => {
    const resolved = resolveContainerLinkType([
      { name: 'Relates', inward: 'relates to', outward: 'relates to' },
      { name: 'Container', inward: 'is contained by', outward: 'contains' },
    ]);
    expect(resolved?.name).toBe('Container');
    expect(resolved?.containerIsOutward).toBe(true);
  });

  it('places the dev on the inward side when the outward label is the contained side', () => {
    const resolved = resolveContainerLinkType([
      { name: 'Container', inward: 'contains', outward: 'is contained within' },
    ]);
    expect(resolved?.containerIsOutward).toBe(false);
  });

  it('returns null when no container link type exists', () => {
    expect(resolveContainerLinkType([{ name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }])).toBeNull();
  });
});

describe('planLinkFlip', () => {
  const linkType: ContainerLinkType = {
    name: 'Container', inward: 'is contained by', outward: 'contains', containerIsOutward: true,
  };

  it('deletes a backwards container link and recreates it with the dev as container', () => {
    const links: IssueLinkShape[] = [
      { id: '900', type: { name: 'Container' }, outwardIssue: { key: 'ENFCT-1214' } },
      { id: '901', type: { name: 'Relates' }, outwardIssue: { key: 'ENFCT-9999' } },
    ];
    const plan = planLinkFlip('ENFCT-2032', 'ENFCT-1214', links, linkType);
    expect(plan.deleteLinkIds).toEqual(['900']);
    expect(plan.createPayload).toEqual({
      type: { name: 'Container' },
      outwardIssue: { key: 'ENFCT-1214' },
      inwardIssue: { key: 'ENFCT-2032' },
    });
  });

  it('creates the link with the dev inward when the container is the inward side', () => {
    const inwardType: ContainerLinkType = { ...linkType, containerIsOutward: false };
    const plan = planLinkFlip('ENFCT-2032', 'ENFCT-1214', [], inwardType);
    expect(plan.deleteLinkIds).toEqual([]);
    expect(plan.createPayload.inwardIssue).toEqual({ key: 'ENFCT-1214' });
    expect(plan.createPayload.outwardIssue).toEqual({ key: 'ENFCT-2032' });
  });
});

describe('findTransitionMatching', () => {
  const transitions = [
    { id: '11', name: 'Start', to: { name: 'Working' } },
    { id: '21', name: 'Cancel', to: { name: 'Cancelled' } },
    { id: '31', name: 'Ready', to: { name: 'Ready to Work' } },
  ];

  it('matches by target status name', () => {
    expect(findTransitionMatching(transitions, /cancel/i)?.id).toBe('21');
    expect(findTransitionMatching(transitions, /ready to work/i)?.id).toBe('31');
  });

  it('returns null when nothing matches', () => {
    expect(findTransitionMatching(transitions, /accepted/i)).toBeNull();
  });
});

describe('describeAction', () => {
  it('gives a readable line for each action', () => {
    expect(describeAction('cancel')).toMatch(/cancel/i);
    expect(describeAction('flip-clone')).toMatch(/clone/i);
    expect(describeAction('ready-to-work')).toMatch(/ready to work/i);
    expect(describeAction('skip')).toMatch(/skip/i);
  });
});
