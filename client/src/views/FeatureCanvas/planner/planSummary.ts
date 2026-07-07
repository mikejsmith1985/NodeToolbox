// planSummary.ts — Pure plain-text renderer for a capacity PlanResult (feature 013, Layer 4a copy-out).
//
// The read-only Capacity Plan panel shows the projection on screen; this module reproduces the SAME
// projection as a single shareable plain-text block for the "Copy summary" button. It is deliberately
// pure (no clock, no DOM, no I/O) so it can be unit-tested exhaustively and reused anywhere the plan
// needs to be pasted (a chat, a ticket, an email). Identical input always yields identical text.

import type {
  AssignmentProposal,
  DeliveryRole,
  PlanResult,
  ProjectedSprint,
  SprintPersonLoad,
} from './capacityTypes.ts';

// ── Named constants (no magic strings) ───────────────────────────────────────

/** Plain-English label for each delivery role in the operator-facing summary. */
const ROLE_LABELS: Record<DeliveryRole, string> = {
  dev: 'development',
  internalTest: 'internal testing',
  externalTest: 'external testing',
};

// ── Section builders (each returns the lines for one part of the summary) ─────

/** Renders one person's per-role load as a compact single line (dev / int / ext points). */
function formatPersonLoad(load: SprintPersonLoad): string {
  return `    ${load.displayName} — ${load.devPoints} dev / ${load.internalTestPoints} int / ${load.externalTestPoints} ext`;
}

/** Renders one projected sprint: its number, date range, beyond-PI flag, and every person's load. */
function formatSprint(sprint: ProjectedSprint): string {
  const beyondFlag = sprint.isBeyondPiEnd ? ' (beyond PI end)' : '';
  const header = `Sprint ${sprint.index} (${sprint.startIso} → ${sprint.endIso})${beyondFlag} — ${sprint.scheduledPoints} pts`;
  const personLines = sprint.loads.map(formatPersonLoad);
  return [header, ...personLines].join('\n');
}

/** Renders the bottleneck statement plus, when a role is limiting, the two staffing-gap numbers. */
function formatBottleneckSection(result: PlanResult): string {
  const lines = ['BOTTLENECK', result.bottleneck.statement];
  if (result.bottleneck.limitingRole !== null) {
    lines.push(
      `  Additional ${ROLE_LABELS[result.bottleneck.limitingRole]} people to match dev throughput: ${result.bottleneck.additionalToMatchThroughput}`,
      `  Additional to finish by the PI end: ${result.bottleneck.additionalToFinishByPiEnd}`,
    );
  }
  return lines.join('\n');
}

/** Renders the completion projection, noting how far it lands beyond the PI end when it does. */
function formatCompletionSection(result: PlanResult): string {
  const completionDate = result.completionDateIso ?? 'not scheduled (no work placed)';
  const beyondNote =
    result.sprintsBeyondPiEnd > 0
      ? ` — ${result.sprintsBeyondPiEnd} sprint(s) beyond the PI end`
      : '';
  return ['COMPLETION', `  Completes in sprint ${result.completionSprintIndex} on ${completionDate}${beyondNote}`].join('\n');
}

/** Renders one assignment proposal as a single line (never written to Jira; a suggestion only). */
function formatProposal(proposal: AssignmentProposal): string {
  const from = proposal.fromAssignee ?? 'Unassigned';
  return `  ${proposal.itemKey}: ${from} → ${proposal.toAssignee} (${ROLE_LABELS[proposal.role]}) — ${proposal.reason}`;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Formats a full capacity PlanResult as one shareable plain-text block: the bottleneck and its staffing
 * gap, the completion projection, every projected sprint with each person's per-role load, and any
 * assignment proposals or unschedulable items. Pure and read-only — it never mutates the plan or Jira.
 */
export function formatPlanSummary(result: PlanResult, piName: string): string {
  const sections: string[] = [
    `CAPACITY PLAN — ${piName || 'current PI'}`,
    formatBottleneckSection(result),
    formatCompletionSection(result),
    ['PROJECTED SPRINTS', ...result.sprints.map(formatSprint)].join('\n'),
  ];

  if (result.proposals.length > 0) {
    sections.push(['ASSIGNMENT PROPOSALS (read-only — nothing written to Jira)', ...result.proposals.map(formatProposal)].join('\n'));
  }
  if (result.unschedulableItemKeys.length > 0) {
    sections.push(['UNSCHEDULABLE ITEMS (no capacity for a required role)', `  ${result.unschedulableItemKeys.join(', ')}`].join('\n'));
  }

  return sections.join('\n\n');
}
