// containerFactory.test.ts — Verifies provisional container construction and titling.

import { describe, expect, it } from 'vitest';

import { createCompleteContainer, createParkingLotContainer, createProvisionalContainer, createRealSprintContainer, positionInContainer } from './containerFactory.ts';

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

  it('wraps into a new row so boxes never overlap the previous row', () => {
    const first = createProvisionalContainer('sprint', 0);
    const fourth = createProvisionalContainer('sprint', 3); // wraps to column 0, row 2
    expect(fourth.bounds.x).toBe(first.bounds.x); // same column as the first
    expect(fourth.bounds.y).toBeGreaterThan(first.bounds.y + first.bounds.height); // but a full row lower — no overlap
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
