// stages.ts — The five-stage coaching journey definitions (pure data, no AI references).
//
// Each stage has a single job and a single visible output, sized for one ~30-minute working
// session. The order is the recommended recovery sequence for a chaotic backlog: surface the work,
// size and prioritize it, THEN stabilize WIP with that context (so you never park high-value or
// nearly-done work), and only then box it into a plan. Guidance is written to the USER; nothing
// here references or depends on AI.

import type { StageId } from '../overlay/overlayModel.ts';

/** One coaching stage's presentation and completion contract. */
export interface CoachStage {
  id: StageId;
  order: number;
  title: string;
  job: string;
  decision: string;
  output: string;
}

/** The ordered coaching stages surfaced by the CoachPanel. */
export const COACH_STAGES: readonly CoachStage[] = [
  {
    id: 'surface',
    order: 1,
    title: 'Surface',
    job: 'Make the mess visible.',
    decision: 'Pull every candidate feature onto the canvas and see the whole battlefield.',
    output: 'Every feature is a node you can move.',
  },
  {
    id: 'size',
    order: 2,
    title: 'Size',
    job: 'Make it estimable.',
    decision: 'Give each feature a quick relative size (S / M / L / XL) — so priority and WIP calls can weigh effort against value and completion.',
    output: 'Every in-scope feature carries a size so capacity and WIP math work.',
  },
  {
    id: 'prioritize',
    order: 3,
    title: 'Prioritize',
    job: 'Find the signal.',
    decision: 'Sort each feature into Must, Should, Could, or Won’t — weighing value against the size you just set.',
    output: 'An unambiguous, visible order of what matters.',
  },
  {
    id: 'stabilize',
    order: 4,
    title: 'Stabilize WIP',
    job: 'Stop the bleeding — deliberately.',
    decision: 'Move finished features to Complete (always safe), then park the lowest-priority / least-progressed work above your WIP limit. Never park what is nearly done or high value.',
    output: 'A bounded active set and an explicit, reasoned parked list.',
  },
  {
    id: 'sequence',
    order: 5,
    title: 'Sequence & Box',
    job: 'Make it a plan.',
    decision: 'Drag sized features into release and sprint boxes within their capacity.',
    output: 'A concrete Now / Next / Later plan you can commit.',
  },
];

/** Looks up a stage definition by id. */
export function findStage(stageId: StageId): CoachStage {
  return COACH_STAGES.find((stage) => stage.id === stageId) ?? COACH_STAGES[0];
}
