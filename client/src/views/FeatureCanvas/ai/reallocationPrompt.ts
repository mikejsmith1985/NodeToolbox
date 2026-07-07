// reallocationPrompt.ts — Turns an assembled re-allocation context into a single copy-out prompt.
//
// This is the one-way Part 2 output: a human pastes the string into an assistant and reads the plan
// back. Nothing is ingested. The prompt states the goal, the PI runway, the estimation conventions,
// the roster with roles, each person's target-sprint work, the operator's verbatim constraints, the
// required output shape, and the guardrails. Pure — same context in, same string out.

import type { ReallocationContext, ReallocationPersonLoad, ReallocationWorkItem } from './reallocationModel.ts';
import type { RosterRoleCapabilities } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';

const DEVELOPER_ROLE_LABEL = 'Developer';
const INTERNAL_TESTER_ROLE_LABEL = 'Internal Tester';
const EXTERNAL_TESTER_ROLE_LABEL = 'External Tester';
const NO_ROLES_LABEL = 'no roles set';

// The estimation conventions, output shape, and guardrails are fixed instruction text (item 3, 7, 8).
const ESTIMATION_CONVENTIONS_SECTION =
  'Estimation conventions:\n'
  + '- A story point is roughly one day of work, so convert point totals to day-estimates against the days remaining.\n'
  + '- Time-in-status is a soft progress signal (longer in an active status usually means nearer done, or stalled), '
  + 'not a guarantee — weigh it, do not treat it as fact.';

const OUTPUT_INSTRUCTION_SECTION =
  'Produce:\n'
  + '1. A re-allocation plan grouped by person — move each work item only to someone who holds a role that '
  + 'matches the work (development, internal testing, or external testing), using the remaining PI days.\n'
  + '2. An explicit risk assessment for completing the sprint — call out role bottlenecks, overloaded people, '
  + 'unstaffed testing, and any unassigned or blocked work.';

const GUARDRAILS_SECTION =
  'Guardrails: reason ONLY from the data and constraints given above. Do not invent people, roles, '
  + 'assignments, sprints, points, or statuses.';

/** Formats a person's role capabilities as a readable label list, or a "none set" note. */
function formatRoles(roles: RosterRoleCapabilities | null): string {
  if (roles === null) {
    return '';
  }
  const roleLabels: string[] = [];
  if (roles.canDevelop) {
    roleLabels.push(DEVELOPER_ROLE_LABEL);
  }
  if (roles.canInternalTest) {
    roleLabels.push(INTERNAL_TESTER_ROLE_LABEL);
  }
  if (roles.canExternalTest) {
    roleLabels.push(EXTERNAL_TESTER_ROLE_LABEL);
  }
  return roleLabels.length > 0 ? roleLabels.join(', ') : NO_ROLES_LABEL;
}

/** Item 1 — frames the goal around the named target sprint and the remaining PI time. */
function buildFramingSection(context: ReallocationContext): string {
  return `Goal: plan how to move work across the team to maximize the chance of completing the sprint `
    + `"${context.targetSprintTitle}", using the remaining PI time.`;
}

/** Item 2 — states the PI runway with both ends, or that the runway is unknown. */
function buildRunwaySection(context: ReallocationContext): string {
  if (context.piStartIso === null || context.piEndIso === null || context.daysRemainingInPi === null) {
    return `PI runway: "${context.piName}" carries no parseable date range, so the runway is unknown.`;
  }
  return `PI runway: "${context.piName}" runs ${context.piStartIso} to ${context.piEndIso}, `
    + `${context.daysRemainingInPi} days remaining.`;
}

/** Item 4 — every active roster member with their roles, including spare-capacity (no-work) members. */
function buildRosterSection(context: ReallocationContext): string {
  const workingMemberLines = context.loads
    .filter((load) => load.isOnRoster)
    .map((load) => `- ${load.displayName} — roles: ${formatRoles(load.roles)} (has work this sprint)`);
  const spareCapacityLines = context.rosterWithoutWork.map(
    (member) => `- ${member.displayName} — roles: ${formatRoles(member.roles)} (spare capacity — no work this sprint)`,
  );
  const memberLines = [...workingMemberLines, ...spareCapacityLines];
  const rosterBody = memberLines.length > 0 ? memberLines.join('\n') : '- (no roster members)';
  return `Team roster with roles:\n${rosterBody}`;
}

/** Formats one work item line: key, summary, points, raw status (+category), and days-in-status. */
function formatWorkItem(item: ReallocationWorkItem): string {
  const pointsLabel = item.storyPoints === null ? 'unpointed' : `${item.storyPoints} points`;
  const categoryLabel = item.statusCategoryKey === null ? '' : ` (${item.statusCategoryKey})`;
  const daysLabel = item.daysInStatus === null ? 'time in status unknown' : `${item.daysInStatus} days in status`;
  return `  - ${item.key} · ${item.summary} · ${pointsLabel} · ${item.status}${categoryLabel} · ${daysLabel}`;
}

/** Builds the header line for one person/bucket, flagging off-roster and unassigned owners. */
function formatLoadHeader(load: ReallocationPersonLoad): string {
  if (load.isOnRoster) {
    return `${load.displayName} — roles: ${formatRoles(load.roles)} — ${load.totalPoints} points:`;
  }
  const bucketLabel = load.displayName === 'Unassigned' ? 'Unassigned work' : `${load.displayName} (off-roster assignee)`;
  return `${bucketLabel} — ${load.totalPoints} points:`;
}

/** Item 5 — per-person target-sprint work, with explicit unassigned and off-roster buckets. */
function buildPerPersonWorkSection(context: ReallocationContext): string {
  if (context.loads.length === 0) {
    return `Target-sprint work by person:\n- (no assigned work in this sprint)`;
  }
  const loadBlocks = context.loads.map(
    (load) => `${formatLoadHeader(load)}\n${load.items.map(formatWorkItem).join('\n')}`,
  );
  return `Target-sprint work by person:\n${loadBlocks.join('\n')}`;
}

/** Item 6 — the operator's free text, verbatim, framed as constraints; omitted when empty. */
function buildDetailsSection(additionalDetails: string): string | null {
  const trimmedDetails = additionalDetails.trim();
  if (!trimmedDetails) {
    return null;
  }
  return `Additional details (constraints you MUST honor):\n${trimmedDetails}`;
}

/**
 * Builds the full copy-out re-allocation prompt from a context and the operator's additional details.
 * The result contains all eight required content items in a legible, copyable layout.
 */
export function buildReallocationPrompt(context: ReallocationContext, additionalDetails: string): string {
  const sections: (string | null)[] = [
    buildFramingSection(context),
    buildRunwaySection(context),
    ESTIMATION_CONVENTIONS_SECTION,
    buildRosterSection(context),
    buildPerPersonWorkSection(context),
    buildDetailsSection(additionalDetails),
    OUTPUT_INSTRUCTION_SECTION,
    GUARDRAILS_SECTION,
  ];
  return sections.filter((section): section is string => section !== null).join('\n\n');
}
