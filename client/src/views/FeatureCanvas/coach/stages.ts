// stages.ts — The five-stage coaching journey definitions (pure data, no AI references).
//
// Each stage has a single job and a single visible output, sized for one ~30-minute working
// session. The order is the recommended recovery sequence for a chaotic backlog: you cannot
// prioritize before you can see, or plan before you can size. Guidance is written to the USER;
// nothing here references or depends on AI.

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
    id: 'stabilize',
    order: 2,
    title: 'Stabilize WIP',
    job: 'Stop the bleeding.',
    decision: 'Set a WIP limit, then drag everything above it into the Parking Lot.',
    output: 'A bounded active set and an explicit list of what you are pausing.',
  },
  {
    id: 'prioritize',
    order: 3,
    title: 'Prioritize',
    job: 'Find the signal.',
    decision: 'Sort each feature into Must, Should, Could, or Won’t.',
    output: 'An unambiguous, visible order of what matters.',
  },
  {
    id: 'size',
    order: 4,
    title: 'Size',
    job: 'Make it estimable.',
    decision: 'Give each prioritized feature a quick relative size (S / M / L / XL).',
    output: 'Every in-scope feature carries a size so capacity math works.',
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
