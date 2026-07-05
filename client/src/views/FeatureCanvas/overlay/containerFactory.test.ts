// containerFactory.test.ts — Verifies provisional container construction and titling.

import { describe, expect, it } from 'vitest';

import { boxHeightForCount, createCompleteContainer, createLaterContainer, createParkingLotContainer, createProvisionalContainer, createRealSprintContainer, layoutBoxes, positionInContainer } from './containerFactory.ts';

describe('createProvisionalContainer', () => {
  it('builds a provisional sprint with a default title and a budget', () => {
    const container = createProvisionalContainer('sprint', 0);
    expect(container.kind).toBe('sprint');
    expect(container.title).toBe('New sprint');
    expect(container.capacityBudget).toBe(20);
    expect(container.provenance.state).toBe('provisional');
  });

  it('uses a supplied title (trimmed) when given — e.g. from AI Sprint grouping', () => {
    expect(createProvisionalContainer('sprint', 0, '  Sprint 25  ').title).toBe('Sprint 25');
  });

  it('builds a real sprint box from an existing Jira sprint (id-derived, provenance real)', () => {
    const box = createRealSprintContainer(42, 'Sprint 25', 0, '2026-05-21', '2026-06-03');
    expect(box.id).toBe('sprint-42');
    expect(box.kind).toBe('sprint');
    expect(box.title).toBe('Sprint 25');
    expect(box.provenance).toMatchObject({ state: 'real', jiraSprintId: 42, startDateIso: '2026-05-21', endDateIso: '2026-06-03' });
  });

  it('builds a release with no default budget', () => {
    const container = createProvisionalContainer('release', 1);
    expect(container.kind).toBe('release');
    expect(container.capacityBudget).toBeNull();
  });

  it('tiles successive boxes across the band by existing count', () => {
    expect(createProvisionalContainer('sprint', 0).bounds.x).toBe(40);
    expect(createProvisionalContainer('sprint', 1).bounds.x).toBe(480);
  });

  it('builds the canvas-only Later box', () => {
    const later = createLaterContainer(0);
    expect(later.kind).toBe('later');
    expect(later.title).toBe('Later');
    expect(later.provenance.state).toBe('provisional');
  });

  it('wraps into a new row so boxes never overlap the previous row', () => {
    const first = createProvisionalContainer('sprint', 0);
    const third = createProvisionalContainer('sprint', 2); // two columns → index 2 wraps to column 0, row 2
    expect(third.bounds.x).toBe(first.bounds.x); // same column as the first
    expect(third.bounds.y).toBeGreaterThan(first.bounds.y + first.bounds.height); // but a full row lower — no overlap
  });

  it('builds the Parking Lot and Complete boxes with no budget', () => {
    const lot = createParkingLotContainer(0);
    expect(lot.kind).toBe('parkingLot');
    expect(lot.title).toBe('Parking Lot');
    expect(lot.capacityBudget).toBeNull();

    const done = createCompleteContainer(0);
    expect(done.kind).toBe('complete');
    expect(done.title).toBe('Complete');
  });
});

describe('positionInContainer', () => {
  it('stacks members in a column below the box header', () => {
    const box = createProvisionalContainer('sprint', 0); // bounds.x = 40
    const first = positionInContainer(box, 0);
    const second = positionInContainer(box, 1);
    expect(first.x).toBe(box.bounds.x + 16);
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThan(first.y); // each subsequent card sits lower
  });
});

describe('boxHeightForCount / layoutBoxes', () => {
  it('sizes a box taller for more cards (and at least one slot when empty)', () => {
    expect(boxHeightForCount(0)).toBe(boxHeightForCount(1)); // min one slot
    expect(boxHeightForCount(5)).toBeGreaterThan(boxHeightForCount(2));
  });

  it('lays boxes into two columns, each sized to its cards, filling the shorter column', () => {
    const bounds = layoutBoxes([
      { id: 'a', memberCount: 5 }, // tall → column 0
      { id: 'b', memberCount: 1 }, // column 1
      { id: 'c', memberCount: 1 }, // column 1 was shorter → still column 1, stacked under b
    ]);
    const columnXs = new Set([bounds.get('a')!.x, bounds.get('b')!.x, bounds.get('c')!.x]);
    expect(columnXs.size).toBe(2); // exactly two columns
    expect(bounds.get('a')!.height).toBeGreaterThan(bounds.get('b')!.height); // sized to card count
    expect(bounds.get('b')!.x).toBe(bounds.get('c')!.x); // b and c share a column
    expect(bounds.get('c')!.y).toBeGreaterThan(bounds.get('b')!.y); // c stacked below b, no overlap
  });
});
