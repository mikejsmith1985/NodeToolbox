// PiPlanCapacityMap.tsx — The full capacity map (spec 028, US2). Renders committed-vs-available per
// person per sprint from the SAME PlanResult that drives the schedule (agree-by-construction, FR-042),
// flagging any person-sprint over-allocation. Purely presentational — no computation of its own beyond
// summing the loads the planner already produced.

import React from 'react';

import type { PersonCapacity, PlanResult } from '../../FeatureCanvas/planner/capacityTypes.ts';

interface PiPlanCapacityMapProps {
  planResult: PlanResult;
  people: PersonCapacity[];
}

/** Total committed points for one person in one sprint (dev + internal test + external test). */
function committedFor(planResult: PlanResult, sprintName: string, displayName: string): number {
  const sprint = planResult.sprints.find((candidate) => candidate.name === sprintName);
  const load = sprint?.loads.find((candidate) => candidate.displayName === displayName);
  if (!load) {
    return 0;
  }
  return load.devPoints + load.internalTestPoints + load.externalTestPoints;
}

/** Renders the per-person, per-sprint committed/available grid with over-allocation flags and roll-ups. */
export function PiPlanCapacityMap({ planResult, people }: PiPlanCapacityMapProps): React.ReactElement {
  const sprints = planResult.sprints;
  return (
    <table className="pi-plan-capacity-map" aria-label="Capacity map">
      <thead>
        <tr>
          <th scope="col">Person</th>
          {sprints.map((sprint) => (
            <th scope="col" key={sprint.name}>{sprint.name}{sprint.isBeyondPiEnd ? ' *' : ''}</th>
          ))}
          <th scope="col">PI total</th>
        </tr>
      </thead>
      <tbody>
        {people.map((person) => {
          const available = person.pointsPerSprint;
          const committedTotal = sprints.reduce((sum, sprint) => sum + committedFor(planResult, sprint.name, person.displayName), 0);
          return (
            <tr key={person.displayName}>
              <th scope="row">{person.displayName}</th>
              {sprints.map((sprint) => {
                const committed = committedFor(planResult, sprint.name, person.displayName);
                const isOverAllocated = committed > available;
                return (
                  <td
                    key={sprint.name}
                    className={isOverAllocated ? 'pi-plan-over-allocated' : undefined}
                    data-over-allocated={isOverAllocated ? 'true' : 'false'}
                    title={isOverAllocated ? `Over by ${committed - available} pts` : undefined}
                  >
                    {committed}/{available}
                    {isOverAllocated ? ` ⚠ +${committed - available}` : ''}
                  </td>
                );
              })}
              <td>{committedTotal}/{available * sprints.length}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
