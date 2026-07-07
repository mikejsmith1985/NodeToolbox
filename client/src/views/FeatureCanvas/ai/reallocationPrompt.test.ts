// reallocationPrompt.test.ts — Verifies the copy-out prompt carries all eight required content items.

import { describe, expect, it } from 'vitest';

import type { ReallocationContext } from './reallocationModel.ts';
import { buildReallocationPrompt } from './reallocationPrompt.ts';

const VERBATIM_DETAILS = 'ESI only has two devs who can work it; do not assign external testing to Bob.';

/** A rich context exercising roster roles, spare capacity, unassigned, and off-roster buckets. */
function createContext(overrides: Partial<ReallocationContext> = {}): ReallocationContext {
  return {
    targetSprintTitle: 'Sprint 25',
    piName: 'PI 26.3 (05/21/26 - 07/29/26)',
    piStartIso: '2026-05-21',
    piEndIso: '2026-07-29',
    daysRemainingInPi: 22,
    loads: [
      {
        displayName: 'Jane Doe',
        roles: { canDevelop: true, canInternalTest: false, canExternalTest: false },
        isOnRoster: true,
        items: [
          { key: 'S-1', summary: 'Build login form', storyPoints: 5, status: 'In Dev', statusCategoryKey: 'indeterminate', daysInStatus: 4, assignee: 'Jane Doe' },
        ],
        totalPoints: 5,
      },
      {
        displayName: 'Contractor Carl',
        roles: null,
        isOnRoster: false,
        items: [
          { key: 'S-2', summary: 'Integration work', storyPoints: 3, status: 'In QA', statusCategoryKey: 'indeterminate', daysInStatus: null, assignee: 'Contractor Carl' },
        ],
        totalPoints: 3,
      },
      {
        displayName: 'Unassigned',
        roles: null,
        isOnRoster: false,
        items: [
          { key: 'S-3', summary: 'Orphan story', storyPoints: null, status: 'To Do', statusCategoryKey: 'new', daysInStatus: null, assignee: null },
        ],
        totalPoints: 0,
      },
    ],
    rosterWithoutWork: [
      { displayName: 'Idle Ivan', roles: { canDevelop: false, canInternalTest: true, canExternalTest: true } },
    ],
    unassignedCount: 1,
    offRosterAssignees: ['Contractor Carl'],
    ...overrides,
  };
}

describe('buildReallocationPrompt', () => {
  it('1. frames the goal around the named target sprint and remaining PI time', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt).toContain('Sprint 25');
    expect(prompt.toLowerCase()).toMatch(/move work/);
    expect(prompt.toLowerCase()).toMatch(/remaining pi time|remaining pi|time left/);
  });

  it('2. states the PI runway with both start and end dates and days remaining', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt).toContain('2026-05-21');
    expect(prompt).toContain('2026-07-29');
    expect(prompt).toContain('22');
  });

  it('2b. says the runway is unknown when the PI name carries no parseable range', () => {
    const prompt = buildReallocationPrompt(
      createContext({ piStartIso: null, piEndIso: null, daysRemainingInPi: null, piName: 'PI 26.3' }),
      '',
    );
    expect(prompt.toLowerCase()).toContain('unknown');
  });

  it('3. states the estimation conventions (point ≈ one day; time-in-status is a soft signal)', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt.toLowerCase()).toMatch(/story point/);
    expect(prompt.toLowerCase()).toMatch(/one day|1 day/);
    expect(prompt.toLowerCase()).toMatch(/time.in.status/);
    expect(prompt.toLowerCase()).toMatch(/soft/);
  });

  it('4. lists the roster with roles, including no-work members as spare capacity', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('Developer');
    expect(prompt).toContain('Internal Tester');
    expect(prompt).toContain('External Tester');
    expect(prompt).toContain('Idle Ivan');
    expect(prompt.toLowerCase()).toMatch(/spare capacity|no.*work/);
  });

  it('5. lists per-person work with key, summary, points, raw status (+category), and days-in-status', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt).toContain('S-1');
    expect(prompt).toContain('Build login form');
    expect(prompt).toContain('In Dev');
    expect(prompt).toContain('indeterminate');
    expect(prompt).toMatch(/4\s*day/i);
    // Explicit unassigned + off-roster buckets.
    expect(prompt).toContain('Unassigned');
    expect(prompt.toLowerCase()).toMatch(/off-roster|off roster/);
    expect(prompt).toContain('Contractor Carl');
  });

  it('6. injects the additional details verbatim, framed as constraints to honor', () => {
    const prompt = buildReallocationPrompt(createContext(), VERBATIM_DETAILS);
    expect(prompt).toContain(VERBATIM_DETAILS);
    expect(prompt.toLowerCase()).toMatch(/constraint/);
    expect(prompt.toLowerCase()).toMatch(/honor|honour|must/);
  });

  it('7. instructs a plan grouped by person with role-legal moves and an explicit risk assessment', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt.toLowerCase()).toMatch(/grouped by person|by person/);
    expect(prompt.toLowerCase()).toMatch(/role/);
    expect(prompt.toLowerCase()).toMatch(/risk/);
  });

  it('8. states the guardrails: reason only from the data, invent nothing', () => {
    const prompt = buildReallocationPrompt(createContext(), '');
    expect(prompt.toLowerCase()).toMatch(/do not invent|don't invent/);
    expect(prompt.toLowerCase()).toMatch(/people/);
    expect(prompt.toLowerCase()).toMatch(/roles/);
    expect(prompt.toLowerCase()).toMatch(/sprints/);
  });

  it('omits an additional-details section entirely when the operator supplied none', () => {
    const prompt = buildReallocationPrompt(createContext(), '   ');
    expect(prompt.toLowerCase()).not.toMatch(/additional details/);
  });
});
