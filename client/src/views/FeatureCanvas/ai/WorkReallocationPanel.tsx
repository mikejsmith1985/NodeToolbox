// WorkReallocationPanel.tsx — The hidden, passphrase-gated "Work Re-Allocation Plan" copy-out panel.
//
// One-way accelerator: it assembles the active-team roster (with roles), a chosen target sprint's
// assigned work (status, time-in-status, points, grouped by person), the PI runway, and the operator's
// free-text constraints into a single prompt the operator copies into an external assistant. Unlike the
// AI suggestions panel it has NO ingest/accept-reject step and changes NOTHING on the canvas or in Jira —
// the assistant's documented plan + risks is the deliverable, read externally. Inert unless AI is unlocked.

import { useMemo, useState } from 'react';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import controlStyles from '../canvas/canvasControls.module.css';
import { copyToClipboard } from './clipboard.ts';
import { buildReallocationContext } from './reallocationModel.ts';
import { buildReallocationPrompt } from './reallocationPrompt.ts';
import { useReallocationDetailsStore } from './useReallocationDetailsStore.ts';

/** Props for the gated Work Re-Allocation panel. */
export interface WorkReallocationPanelProps {
  /** The feature nodes on the canvas (their child stories are the allocatable units). */
  canvasNodes: readonly CanvasNode[];
  /** The canvas's sprint containers — the selectable target sprints. */
  sprintContainers: readonly CanvasContainer[];
  /** The active-team roster (with role capabilities) the plan reasons about. */
  rosterMembers: readonly StandupRosterMember[];
  /** Active PI name (may carry a date range) — drives the runway in the prompt. */
  piName: string;
  /** Active Team-Dashboard profile id — scopes the persisted additional-details. */
  teamProfileId: string;
  /** Active project key — scopes the persisted additional-details. */
  projectKey: string;
  onClose: () => void;
}

/** Reports whether any roster member has at least one of the three role capabilities set. */
function hasAnyRoleCoverage(rosterMembers: readonly StandupRosterMember[]): boolean {
  return rosterMembers.some((member) => {
    const roles = member.roleCapabilities;
    return roles !== undefined && (roles.canDevelop || roles.canInternalTest || roles.canExternalTest);
  });
}

/** The gated Work Re-Allocation copy-out panel. Renders nothing when AI Assist is locked. */
export function WorkReallocationPanel({
  canvasNodes,
  sprintContainers,
  rosterMembers,
  piName,
  teamProfileId,
  projectKey,
  onClose,
}: WorkReallocationPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const additionalDetails = useReallocationDetailsStore((state) => state.additionalDetails);
  const setScope = useReallocationDetailsStore((state) => state.setScope);
  const setAdditionalDetails = useReallocationDetailsStore((state) => state.setAdditionalDetails);

  // Point the persisted details box at this canvas's exact scope (team + project + PI). Doing it in
  // render (memoized on the scope inputs) keeps the store aligned as the operator swaps team or PI.
  useMemo(() => setScope(teamProfileId, projectKey, piName), [setScope, teamProfileId, projectKey, piName]);

  // Default the target to the first (earliest) sprint box; keep any still-valid explicit selection.
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const effectiveSprintId = selectedSprintId !== null && sprintContainers.some((container) => container.id === selectedSprintId)
    ? selectedSprintId
    : sprintContainers[0]?.id ?? null;
  const targetSprint = sprintContainers.find((container) => container.id === effectiveSprintId) ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const context = useMemo(() => {
    if (targetSprint === null) {
      return null;
    }
    return buildReallocationContext(canvasNodes, targetSprint.id, targetSprint.title, rosterMembers, piName, today);
  }, [canvasNodes, targetSprint, rosterMembers, piName, today]);

  const prompt = useMemo(
    () => (context === null ? '' : buildReallocationPrompt(context, additionalDetails)),
    [context, additionalDetails],
  );

  // Guard: invisible and inert unless the operator has unlocked AI Assist.
  if (!isUnlocked) {
    return null;
  }

  const hasRoster = rosterMembers.length > 0;
  const hasSprints = sprintContainers.length > 0;
  const hasAssignedWork = context !== null && context.loads.some((load) => load.items.length > 0);
  const hasRoleCoverage = hasAnyRoleCoverage(rosterMembers);

  return (
    <div className={controlStyles.popover} style={{ position: 'absolute', right: 340, top: 16, width: 380, padding: 16, zIndex: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>⚖️ Work re-allocation plan (optional)</strong>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close work re-allocation">✕</button>
      </div>

      {!hasRoster ? (
        <p style={{ margin: '10px 0', fontSize: 12 }}>
          Add a team roster (with roles) in Team Dashboard → Roster to plan re-allocation.
        </p>
      ) : !hasSprints ? (
        <p style={{ margin: '10px 0', fontSize: 12 }}>
          Define a sprint on the canvas first (Sequence &amp; Box → “↧ Pull sprints from board”) — the plan targets one sprint.
        </p>
      ) : (
        <>
          <label style={{ display: 'block', margin: '8px 0', fontSize: 12 }}>
            Target sprint:
            <select
              aria-label="Target sprint"
              value={effectiveSprintId ?? ''}
              onChange={(event) => setSelectedSprintId(event.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {sprintContainers.map((container) => (
                <option key={container.id} value={container.id}>{container.title}</option>
              ))}
            </select>
          </label>

          {!hasRoleCoverage && (
            <p style={{ margin: '4px 0', fontSize: 11, color: 'var(--color-warning)' }}>
              No roster member has a role set — role-aware reasoning is degraded. Set Developer / Internal Tester / External Tester on the roster.
            </p>
          )}

          <label style={{ display: 'block', margin: '8px 0', fontSize: 12 }}>
            Additional details (constraints the roster can’t hold):
            <textarea
              aria-label="Additional details"
              value={additionalDetails}
              onChange={(event) => setAdditionalDetails(event.target.value)}
              placeholder="e.g. ESI only has two devs who can work it; external testing is frozen until Thursday"
              rows={3}
              style={{ width: '100%', marginTop: 4, fontSize: 11 }}
            />
          </label>

          {!hasAssignedWork ? (
            <p style={{ margin: '10px 0', fontSize: 12 }}>
              No assigned work in “{targetSprint?.title}”. Box some stories into this sprint, then generate the plan.
            </p>
          ) : (
            <>
              <textarea readOnly aria-label="Re-allocation prompt" value={prompt} rows={8} style={{ width: '100%', fontSize: 11 }} />
              <button type="button" className={controlStyles.btn} onClick={() => copyToClipboard(prompt)} style={{ margin: '6px 0' }}>
                📋 Copy prompt
              </button>
              <p style={{ margin: '2px 0', fontSize: 11, opacity: 0.7 }}>
                Paste into your assistant for a documented re-allocation plan + risks. Nothing here is written to the canvas or Jira.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
