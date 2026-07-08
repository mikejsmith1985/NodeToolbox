// CapacityPlanPanel.tsx — The read-only Capacity Plan projection panel (feature 013, Layer 4a).
//
// The operator picks which MoSCoW buckets to include, clicks "Build plan", and this panel runs the
// deterministic pipeline and displays the projection: the internal-testing bottleneck and staffing gap,
// the completion date (with any overrun past the PI end), each projected 2-week sprint's per-person load,
// and any assignment proposals or unschedulable items. It writes NOTHING — to the canvas or to Jira; the
// "Copy summary" button reproduces the whole projection as shareable text. Rendering of a ready plan is
// factored into the presentational <PlanProjectionView> so it can be tested directly with a fixture.

import { useEffect, useMemo, useState } from 'react';

import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import { loadAvailablePiNamesFromJira, type ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import type { MoscowBucket } from '../overlay/overlayModel.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import controlStyles from '../canvas/canvasControls.module.css';
import { copyToClipboard } from '../ai/clipboard.ts';
import type { DeliveryRole, PlanResult, ProjectedSprint } from './capacityTypes.ts';
import { buildPlanEvaluationPrompt, formatPlanSummary } from './planSummary.ts';
import { useCapacityDetailsStore } from './useCapacityDetailsStore.ts';
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
/** Example placeholder guiding the operator toward the kind of real-world constraint to type. */
const ADDITIONAL_DETAILS_PLACEHOLDER =
  'e.g. Internal test must finish DENP-1353 exclusively before any other feature; DoD = internal test complete.';

/** Returns today's date as an ISO calendar day (YYYY-MM-DD) — the single clock read for the date default. */
function readTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Props for the read-only Capacity Plan panel. */
export interface CapacityPlanPanelProps {
  /** The feature nodes on the canvas; their child stories are the planable work. */
  canvasNodes: readonly CanvasNode[];
  /** The active-team roster (with role capabilities) that supplies delivery capacity. */
  rosterMembers: readonly StandupRosterMember[];
  /** Active project key — passed through to the fetch for scope symmetry. */
  projectKey: string;
  /** Active PI name — the default target PI, always offered in the Target PI picker. */
  piName: string;
  /** The team's configured story-points field id. */
  storyPointsFieldId: string;
  /** The ART roster, used to enumerate the selectable Program Increments for the Target PI picker. */
  artTeams: ArtTeam[];
  /** Active team profile id — scopes the persisted operator constraints to this canvas. */
  teamProfileId: string;
  onClose: () => void;
}

// ── Presentational projection view (pure of network/state — fixture-testable) ─

/** Props for the presentational projection: a ready PlanResult, the PI name, and today (for the copy-outs). */
export interface PlanProjectionViewProps {
  result: PlanResult;
  piName: string;
  /** Today's date (ISO), used in the Copilot evaluation prompt so it reasons about PI-vs-carryover. */
  todayIso: string;
  /** Operator constraints (free text) injected verbatim into the Copilot evaluation prompt. */
  additionalDetails: string;
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
export function PlanProjectionView({ result, piName, todayIso, additionalDetails }: PlanProjectionViewProps): React.JSX.Element {
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

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={controlStyles.btn}
          onClick={() => copyToClipboard(formatPlanSummary(result, piName))}
        >
          📋 Copy summary
        </button>
        <button
          type="button"
          className={controlStyles.btnPrimary}
          onClick={() => copyToClipboard(buildPlanEvaluationPrompt(result, piName, todayIso, additionalDetails))}
          title="Copy a prompt (plan + context + instructions) to paste into Copilot to evaluate and improve this plan"
        >
          🤖 Copy prompt for Copilot
        </button>
      </div>
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
  artTeams,
  teamProfileId,
  onClose,
}: CapacityPlanPanelProps): React.JSX.Element {
  const [includedBuckets, setIncludedBuckets] = useState<Set<IncludableBucket>>(
    () => new Set(DEFAULT_INCLUDED_BUCKETS),
  );
  // Track which eligible features the operator has UN-checked. Selected = eligible minus this set, so
  // the default is "plan everything" and changing buckets doesn't clobber the operator's exclusions.
  const [deselectedFeatureKeys, setDeselectedFeatureKeys] = useState<Set<string>>(() => new Set());
  // Today's date for the Copilot evaluation prompt (a display-time read; the pure engine gets its own).
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // The date the projection starts from — defaults to today; the operator can plan from a future date.
  const [startDateIso, setStartDateIso] = useState<string>(() => readTodayIso());
  // The PI the plan targets — its window/cadence drive the projection. Defaults to the active PI.
  const [selectedPiName, setSelectedPiName] = useState<string>(piName);
  // The Program Increments the operator can pick from, enumerated from the ART roster (see effect below).
  const [availablePiNames, setAvailablePiNames] = useState<string[]>([]);

  // Persisted operator constraints (real-world details Jira can't express), scoped to this exact canvas.
  const additionalDetails = useCapacityDetailsStore((state) => state.additionalDetails);
  const setDetailsScope = useCapacityDetailsStore((state) => state.setScope);
  const setAdditionalDetails = useCapacityDetailsStore((state) => state.setAdditionalDetails);

  // Point the persisted details box at this canvas's scope (team + project + selected PI). Memoized on the
  // scope inputs so the constraints stay aligned as the operator swaps the target PI, mirroring the
  // reallocation panel's pattern.
  useMemo(
    () => setDetailsScope(teamProfileId, projectKey, selectedPiName),
    [setDetailsScope, teamProfileId, projectKey, selectedPiName],
  );

  // Load the selectable PIs once per ART roster, reusing ART's PI enumeration (autocomplete → issue-scan
  // fallback). Guarded on an empty roster and cancelled on unmount so a late resolve never sets state on a
  // torn-down panel. The active PI is merged in below so the picker never hides the current scope.
  useEffect(() => {
    if (artTeams.length === 0) {
      return undefined;
    }
    let isCancelled = false;
    loadAvailablePiNamesFromJira(artTeams)
      .then((piNames) => { if (!isCancelled) { setAvailablePiNames(piNames); } })
      .catch(() => { if (!isCancelled) { setAvailablePiNames([]); } });
    return () => { isCancelled = true; };
  }, [artTeams]);

  // Merge the active PI in so it is always selectable, even before/after the async lookup resolves.
  const piOptions = useMemo(
    () => Array.from(new Set([piName, ...availablePiNames].map((name) => name.trim()).filter(Boolean))),
    [piName, availablePiNames],
  );

  // The features the operator can choose from: those with a MoSCoW priority in the included buckets,
  // ordered by bucket then key so the list is stable and scannable.
  const eligibleFeatures = useMemo(
    () => canvasNodes
      .filter((node) => node.priority !== null && includedBuckets.has(node.priority))
      .sort((first, second) => first.issueKey.localeCompare(second.issueKey)),
    [canvasNodes, includedBuckets],
  );

  // The feature keys actually planned = eligible minus the operator's exclusions. This is what lets the
  // operator narrow a huge "Must" bucket down to just their top few "priority one" features.
  const selectedFeatureKeys = useMemo(
    () => new Set(eligibleFeatures.map((feature) => feature.issueKey).filter((key) => !deselectedFeatureKeys.has(key))),
    [eligibleFeatures, deselectedFeatureKeys],
  );

  const planParams = useMemo(
    () => ({
      canvasNodes,
      rosterMembers,
      projectKey,
      piName: selectedPiName,
      storyPointsFieldId,
      includedBuckets,
      selectedFeatureKeys,
      planStartIso: startDateIso,
    }),
    [canvasNodes, rosterMembers, projectKey, selectedPiName, storyPointsFieldId, includedBuckets, selectedFeatureKeys, startDateIso],
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

  const toggleFeature = (featureKey: string): void => {
    setDeselectedFeatureKeys((current) => {
      const next = new Set(current);
      if (next.has(featureKey)) {
        next.delete(featureKey);
      } else {
        next.add(featureKey);
      }
      return next;
    });
  };

  /** Selects every eligible feature (clears all exclusions). */
  const selectAllFeatures = (): void => setDeselectedFeatureKeys(new Set());
  /** Excludes every eligible feature, so the operator can then check just the few they want. */
  const clearAllFeatures = (): void => setDeselectedFeatureKeys(new Set(eligibleFeatures.map((feature) => feature.issueKey)));

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

      <fieldset style={{ border: 'none', padding: 0, margin: '6px 0' }}>
        <legend style={{ fontSize: 12, marginBottom: 4 }}>
          Features to plan ({selectedFeatureKeys.size} of {eligibleFeatures.length}):
        </legend>
        {eligibleFeatures.length === 0 ? (
          <div style={{ fontSize: 11, opacity: 0.6 }}>No prioritized features in the selected buckets.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <button type="button" className={controlStyles.btn} onClick={selectAllFeatures} style={{ fontSize: 11 }}>Select all</button>
              <button type="button" className={controlStyles.btn} onClick={clearAllFeatures} style={{ fontSize: 11 }}>Clear all</button>
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6, padding: 6 }}>
              {eligibleFeatures.map((feature) => (
                <label key={feature.issueKey} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '1px 0' }}>
                  <input
                    type="checkbox"
                    aria-label={feature.issueKey}
                    checked={!deselectedFeatureKeys.has(feature.issueKey)}
                    onChange={() => toggleFeature(feature.issueKey)}
                  />
                  <span style={{ fontWeight: 600 }}>{feature.issueKey}</span>
                  {feature.priority !== null && <span style={{ opacity: 0.6 }}>[{BUCKET_LABELS[feature.priority]}]</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feature.summary}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '6px 0' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          Start date
          <input
            type="date"
            aria-label="Plan start date"
            value={startDateIso}
            onChange={(event) => setStartDateIso(event.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          Target PI
          <select
            aria-label="Target PI"
            value={selectedPiName}
            onChange={(event) => setSelectedPiName(event.target.value)}
          >
            {selectedPiName.trim() === '' && <option value="">— Select a PI —</option>}
            {piOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, margin: '6px 0' }}>
        Additional details (constraints)
        <textarea
          aria-label="Additional details"
          value={additionalDetails}
          onChange={(event) => setAdditionalDetails(event.target.value)}
          placeholder={ADDITIONAL_DETAILS_PLACEHOLDER}
          rows={3}
          style={{ width: '100%', fontSize: 11 }}
        />
      </label>

      <button
        type="button"
        className={controlStyles.btnPrimary}
        onClick={run}
        disabled={status === 'loading' || includedBuckets.size === 0 || (eligibleFeatures.length > 0 && selectedFeatureKeys.size === 0)}
        style={{ margin: '6px 0' }}
      >
        {status === 'loading' ? 'Building…' : '⚙️ Build plan'}
      </button>

      {status === 'error' && error !== null && (
        <p role="alert" style={{ margin: '6px 0', fontSize: 12, color: 'var(--color-danger)' }}>{error}</p>
      )}

      {status === 'ready' && result !== null && (
        <PlanProjectionView result={result} piName={selectedPiName} todayIso={todayIso} additionalDetails={additionalDetails} />
      )}

      <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.7 }}>
        Read-only projection — nothing here is written to the canvas or Jira.
      </p>
    </div>
  );
}
