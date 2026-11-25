// dashboardStory.test.ts — Proves the Enrollment dashboard tells its story in order, and judges Ready to Work supply.
//
// The dashboard is read top to bottom by a Scrum Master or RTE on Kanban teams. These tests pin the order of the
// questions it answers, that each step names only clauses the Kit builds, and the weeks-of-supply arithmetic.

import { describe, expect, it } from 'vitest';

import { buildDashboardStory, computeReadySupply, listMissingClauses, DASHBOARD_CONTROLLER } from './dashboardStory.ts';
import { buildRichFilterClauses } from './enrollmentDashboardKit.ts';

const ALL_CLAUSE_NAMES = new Set(buildRichFilterClauses({
  productOwnerFieldReference: '"Product Owner"',
  productOwnerUserByTeam: { CUC: 'U1', TRANSFORMERS: 'U2' },
  doneStatusNames: ['Done'],
  readyStatusName: 'Ready to Work',
  storyPointsFieldReference: '"Story Points"',
}).map((clause) => clause.name));

describe('buildDashboardStory', () => {
  it('asks the SM/RTE questions in reading order, for Kanban teams', () => {
    expect(buildDashboardStory().map((section) => section.question)).toEqual([
      'Will we make the PI?',
      'How much are we finishing?',
      "What's in flight?",
      "What's stuck or blocked?",
      'Is anyone overloaded?',
      'Is there enough Ready to Work?',
      'Is quality slipping?',
    ]);
  });

  it('numbers the steps after the controller and names a Rich Filters gadget for each', () => {
    const story = buildDashboardStory();
    expect(story.map((section) => section.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(story.every((section) => section.gadget.startsWith('Rich Filter'))).toBe(true);
    expect(DASHBOARD_CONTROLLER.gadget).toBe('Rich Filter Controller');
  });

  it('uses only clauses the Kit builds, so every step can be followed', () => {
    for (const section of buildDashboardStory()) expect(listMissingClauses(section, ALL_CLAUSE_NAMES)).toEqual([]);
  });

  it('names the clauses a step cannot use when the instance lacks them', () => {
    const readySection = buildDashboardStory().find((section) => section.question === 'Is there enough Ready to Work?');
    expect(readySection && listMissingClauses(readySection, new Set(['Team Work']))).toEqual(['Ready Queue', 'Ready but Unestimated']);
  });
});

describe('computeReadySupply', () => {
  it('turns 30 days of finished work into a weekly rate and the Ready to Work queue into weeks of supply', () => {
    expect(computeReadySupply(10, 30)).toMatchObject({ weeklyThroughput: 7, weeksOfSupply: 1.4, verdict: 'healthy' });
  });

  it('warns when the queue will run dry within a week', () => {
    const supply = computeReadySupply(2, 30);
    expect(supply.verdict).toBe('thin');
    expect(supply.message).toMatch(/run dry/);
  });

  it('notes when there is more than three weeks queued', () => {
    expect(computeReadySupply(40, 30).verdict).toBe('deep');
  });

  it('refuses to judge when nothing finished, rather than dividing by zero', () => {
    expect(computeReadySupply(5, 0)).toMatchObject({ weeksOfSupply: null, verdict: 'unknown' });
    expect(computeReadySupply(null, 30).verdict).toBe('unknown');
  });
});
