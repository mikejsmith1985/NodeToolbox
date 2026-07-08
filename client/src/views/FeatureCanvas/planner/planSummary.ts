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

// ── Copilot evaluation prompt (wraps the summary so an assistant can critique + enhance the plan) ─

/** How the deterministic plan was generated — context an assistant needs to reason about it correctly. */
const EVALUATION_ASSUMPTIONS = [
  'How this plan was generated (deterministic — the numbers are computed, not guessed):',
  '- Capacity: each person delivers ~8 story points per 2-week sprint, as one pool spendable across the roles they hold.',
  '- Roles gate work: development → Developers/Dev Leads; internal testing → Internal Testers; external testing → External Testers. Scrum Master / Product Owner / Solution Architect add no delivery capacity.',
  "- Internal-test effort: from QA sub-tasks where they exist, otherwise estimated at ~50% of the item's dev points.",
  '- Sequencing: an item is internally tested after it is developed (slipping to a later sprint when the tester is full); external testing follows internal testing.',
  '- The projection is anchored at TODAY; sprints flagged "beyond PI end" are carryover into the next PI.',
  '- Assignment changes shown are PROPOSALS only — nothing has been written to Jira.',
].join('\n');

/** What we ask the assistant to produce from the plan + assumptions. */
const EVALUATION_INSTRUCTION = [
  'Using ONLY the plan and assumptions above, and today’s date:',
  "1. Evaluate the plan and call out the top risks to completing this PI's committed scope.",
  '2. Recommend concrete, role-legal re-allocations to relieve the bottleneck — move work only to someone who holds the matching role and has spare capacity.',
  '3. State clearly what can realistically finish IN THIS PI (on or before the PI end date) versus what carries into the next PI.',
  '4. Suggest any re-prioritisation or sequencing changes that would deliver more value sooner.',
  '5. If more people in the limiting role are the answer, quantify how many and where they have the most impact.',
  'Be specific — reference issue keys and people from the plan. Do not invent data.',
].join('\n');

/**
 * Wraps the plain-text plan summary in the context (assumptions) and instruction an external assistant
 * (e.g. Copilot) needs to critique and improve the plan with advanced reasoning. Pure — `todayIso` is
 * passed in so the same plan + date always yields the same prompt.
 */
export function buildPlanEvaluationPrompt(result: PlanResult, piName: string, todayIso: string): string {
  return [
    `You are helping a Scrum Master evaluate and improve a capacity plan for ${piName || 'the current PI'}. Today is ${todayIso}.`,
    EVALUATION_ASSUMPTIONS,
    'THE PLAN:',
    formatPlanSummary(result, piName),
    EVALUATION_INSTRUCTION,
  ].join('\n\n');
}
