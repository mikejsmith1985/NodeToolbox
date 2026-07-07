// CapacityPlanPanel.tsx — The read-only Capacity Plan projection panel (feature 013, Layer 4a).
//
// The operator picks which MoSCoW buckets to include, clicks "Build plan", and this panel runs the
// deterministic pipeline and displays the projection: the internal-testing bottleneck and staffing gap,
// the completion date (with any overrun past the PI end), each projected 2-week sprint's per-person load,
// and any assignment proposals or unschedulable items. It writes NOTHING — to the canvas or to Jira; the
// "Copy summary" button reproduces the whole projection as shareable text. Rendering of a ready plan is
// factored into the presentational <PlanProjectionView> so it can be tested directly with a fixture.

import { useMemo, useState } from 'react';

import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { MoscowBucket } from '../overlay/overlayModel.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import controlStyles from '../canvas/canvasControls.module.css';
import { copyToClipboard } from '../ai/clipboard.ts';
import type { DeliveryRole, PlanResult, ProjectedSprint } from './capacityTypes.ts';
import { formatPlanSummary } from './planSummary.ts';
import { useCapacityPlan, type IncludableBucket } from './useCapacityPlan.ts';

// ── Named constants ──────────────────────────────────────────────────────────

/** The buckets offered as checkboxes, in display order; Must/Should/Could default on, Won't off. */
const SELECTABLE_BUCKETS: readonly MoscowBucket[] = ['Must', 'Should', 'Could', 'Wont'];
/** The buckets checked by default when the panel opens. */
const DEFAULT_INCLUDED_BUCKETS: readonly MoscowBucket[] = ['Must', 'Should', 'Could'];
/** Human-facing label for each bucket (Won't renders with an apostrophe). */
const BUCKET_LABELS: Record<MoscowBucket, string> = { Must: 'Must', Should: 'Should', Could: 'Could', Wont: "Won't" };
/** Plain-English label for each delivery role, used in the bottleneck read-out. */
const ROLE_LABELS: Record<DeliveryRole, string> = { dev: 'development', internalTest: 'internal testing', externalTest: 'external testing' };

/** Props for the read-only Capacity Plan panel. */
export interface CapacityPlanPanelProps {
  /** The feature nodes on the canvas; their child stories are the planable work. */
  canvasNodes: readonly CanvasNode[];
  /** The active-team roster (with role capabilities) that supplies delivery capacity. */
  rosterMembers: readonly StandupRosterMember[];
  /** Active project key — passed through to the fetch for scope symmetry. */
  projectKey: string;
  /** Active PI name — drives the projection's PI window. */
  piName: string;
  /** The team's configured story-points field id. */
  storyPointsFieldId: string;
  onClose: () => void;
}

// ── Presentational projection view (pure of network/state — fixture-testable) ─

/** Props for the presentational projection: a ready PlanResult and the PI name for the copy-out header. */
export interface PlanProjectionViewProps {
  result: PlanResult;
  piName: string;
}

/** Formats one person's per-role load line inside a projected sprint. */
function formatLoadLine(devPoints: number, internalTestPoints: number, externalTestPoints: number): string {
  return `${devPoints} dev / ${internalTestPoints} int / ${externalTestPoints} ext`;
}

/** Renders one projected sprint as a compact, scannable block of per-person loads. */
function SprintCard({ sprint }: { sprint: ProjectedSprint }): React.JSX.Element {
  return (
    <div style={{ margin: '6px 0', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        Sprint {sprint.index} · {sprint.startIso} → {sprint.endIso}
        {sprint.isBeyondPiEnd && <span style={{ marginLeft: 6, color: 'var(--color-warning)' }}>· beyond PI end</span>}
        <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 400 }}>({sprint.scheduledPoints} pts)</span>
      </div>
      {sprint.loads.length === 0 ? (
        <div style={{ fontSize: 11, opacity: 0.6 }}>No load placed.</div>
      ) : (
        sprint.loads.map((load) => (
          <div key={load.displayName} style={{ fontSize: 11 }}>
            {load.displayName} — {formatLoadLine(load.devPoints, load.internalTestPoints, load.externalTestPoints)}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Renders a fully-computed capacity plan read-only: the bottleneck statement + staffing gap, the
 * completion projection, each projected sprint's per-person load, and any proposals / unschedulable
 * items. The "Copy summary" button copies the same projection as plain text. Never writes anything.
 */
export function PlanProjectionView({ result, piName }: PlanProjectionViewProps): React.JSX.Element {
  const { bottleneck, sprints, proposals, unschedulableItemKeys } = result;
  return (
    <div>
      <section style={{ margin: '8px 0' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Bottleneck</div>
        <div style={{ fontSize: 12 }}>{bottleneck.statement}</div>
        {bottleneck.limitingRole !== null && (
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
            +{bottleneck.additionalToMatchThroughput} {ROLE_LABELS[bottleneck.limitingRole]} to match dev throughput
            {' · '}
            +{bottleneck.additionalToFinishByPiEnd} to finish by the PI end
          </div>
        )}
      </section>

      <section style={{ margin: '8px 0' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Completion</div>
        <div style={{ fontSize: 12 }}>
          Sprint {result.completionSprintIndex}
          {result.completionDateIso !== null && ` · ${result.completionDateIso}`}
          {result.sprintsBeyondPiEnd > 0 && (
            <span style={{ marginLeft: 6, color: 'var(--color-warning)' }}>
              · {result.sprintsBeyondPiEnd} sprint{result.sprintsBeyondPiEnd === 1 ? '' : 's'} beyond PI end
            </span>
          )}
        </div>
      </section>

      <section style={{ margin: '8px 0' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Projected sprints</div>
        {sprints.length === 0 ? (
          <div style={{ fontSize: 11, opacity: 0.6 }}>No sprints projected.</div>
        ) : (
          sprints.map((sprint) => <SprintCard key={sprint.index} sprint={sprint} />)
        )}
      </section>

      {proposals.length > 0 && (
        <section style={{ margin: '8px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Assignment proposals (read-only)</div>
          {proposals.map((proposal) => (
            <div key={`${proposal.itemKey}:${proposal.role}`} style={{ fontSize: 11 }}>
              {proposal.itemKey}: {proposal.fromAssignee ?? 'Unassigned'} → {proposal.toAssignee} ({ROLE_LABELS[proposal.role]})
            </div>
          ))}
        </section>
      )}

      {unschedulableItemKeys.length > 0 && (
        <section style={{ margin: '8px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)' }}>Unschedulable</div>
          <div style={{ fontSize: 11 }}>{unschedulableItemKeys.join(', ')}</div>
        </section>
      )}

      <button
        type="button"
        className={controlStyles.btn}
        onClick={() => copyToClipboard(formatPlanSummary(result, piName))}
        style={{ marginTop: 6 }}
      >
        📋 Copy summary
      </button>
    </div>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────

/**
 * The read-only Capacity Plan panel. Lets the operator choose which priority buckets to include, builds
 * the deterministic plan on demand, and shows the projection. It never writes to the canvas or Jira.
 */
export function CapacityPlanPanel({
  canvasNodes,
  rosterMembers,
  projectKey,
  piName,
  storyPointsFieldId,
  onClose,
}: CapacityPlanPanelProps): React.JSX.Element {
  const [includedBuckets, setIncludedBuckets] = useState<Set<IncludableBucket>>(
    () => new Set(DEFAULT_INCLUDED_BUCKETS),
  );

  const planParams = useMemo(
    () => ({ canvasNodes, rosterMembers, projectKey, piName, storyPointsFieldId, includedBuckets }),
    [canvasNodes, rosterMembers, projectKey, piName, storyPointsFieldId, includedBuckets],
  );
  const { status, result, error, run } = useCapacityPlan(planParams);

  const toggleBucket = (bucket: IncludableBucket): void => {
    setIncludedBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
  };

  return (
    <div
      className={controlStyles.popover}
      style={{ position: 'absolute', right: 16, top: 16, width: 400, maxHeight: '90%', overflowY: 'auto', padding: 16, zIndex: 30 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>📅 Capacity plan (read-only)</strong>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close capacity plan">✕</button>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: '10px 0 6px' }}>
        <legend style={{ fontSize: 12, marginBottom: 4 }}>Include priority buckets:</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {SELECTABLE_BUCKETS.map((bucket) => (
            <label key={bucket} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                aria-label={BUCKET_LABELS[bucket]}
                checked={includedBuckets.has(bucket)}
                onChange={() => toggleBucket(bucket)}
              />
              {BUCKET_LABELS[bucket]}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        className={controlStyles.btnPrimary}
        onClick={run}
        disabled={status === 'loading' || includedBuckets.size === 0}
        style={{ margin: '6px 0' }}
      >
        {status === 'loading' ? 'Building…' : '⚙️ Build plan'}
      </button>

      {status === 'error' && error !== null && (
        <p role="alert" style={{ margin: '6px 0', fontSize: 12, color: 'var(--color-danger)' }}>{error}</p>
      )}

      {status === 'ready' && result !== null && <PlanProjectionView result={result} piName={piName} />}

      <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.7 }}>
        Read-only projection — nothing here is written to the canvas or Jira.
      </p>
    </div>
  );
}
