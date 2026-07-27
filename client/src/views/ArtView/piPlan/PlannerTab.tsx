// PlannerTab.tsx — The live mount of the PI Planner on the PO Tool surface (spec 028, US1, T024).
// It gathers the planner's inputs from the SAME reused sources PI Review uses — roster, capacity, the
// Feature pull, fixVersions, PI dates, board/project — assembles the prompt context, and renders the
// gated PiPlanPanel. The write path ensures the target sprint exists, then delegates to applyStoryPlan.
// Additive only: this file touches no host logic; PoToolView just renders it behind a new tab.

import React, { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { addIssueComponentsByName, resolveComponentIdsByName } from '../../../services/componentResolve.ts';
import { getComponentKind, repoAllowlist } from '../../AdminHub/lib/componentClassificationStore.ts';
import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx';
import { buildComponentMappingPrompt, parseComponentMappingIngest } from '../../PoTool/ai/componentMappingAiAssist.ts';
import { buildCapacitySummary } from '../../SprintDashboard/capacityModel.ts';
import { useCapacityStore } from '../../SprintDashboard/hooks/useCapacityStore.ts';
import { useStandupRosterStore } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import { parsePiDateRange } from '../hooks/artHelpers.ts';
import { fetchPiReviewFeatureIssues, reconcilePiReviewRowsWithJira } from '../piReviewJira.ts';
import { pullPiReviewFeatures } from '../piReviewPullFeatures.ts';
import { buildPersonCapacities } from './piPlanCapacity.ts';
import { assemblePromptContext } from './piPlanAiFetch.ts';
import { resolvePiPlanFieldIds } from './piPlanFields.ts';
import type { PiPlanFieldIds } from './piPlanFields.ts';
import { applyStoryPlan } from './piPlanJira.ts';
import type { WriteContext } from './piPlanJira.ts';
import { buildReleaseSchedule, fetchPiWindowFixVersions } from './piPlanReleaseSchedule.ts';
import { ensureSprints } from './piPlanSprints.ts';
import { PiPlanPanel } from './PiPlanPanel.tsx';
import { PlanProposalTable } from './PlanProposalTable.tsx';
import { buildPiPlanProposal } from './piPlanEngine.ts';
import { buildRepoStoryAcceptedByFeature } from './repoStoryBreakdown.ts';
import { buildFeatureInputs, deriveSprints, readRepoComponentNames, toIsoDate } from './plannerInputs.ts';
import type { FeatureIssueLike } from './plannerInputs.ts';
import type { FeatureInput, PlanItemProposal, PlanProposal, ReleaseSchedule, ScheduledStory, WorkingCalendar } from './piPlanTypes.ts';

/** Weekends only by default; an org holiday calendar can be layered in later. */
const DEFAULT_WORKING_CALENDAR: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] };
const DEFAULT_SPRINT_LENGTH_DAYS = 14;

interface PlannerTabProps {
  boardId: number | null;
  projectKey: string;
  selectedPiName: string;
  teamProfileId: string;
}

/** The Story and Sub-task issue-type ids for the project, resolved from Jira's create metadata. */
interface IssueTypeIds {
  storyIssueTypeId: string;
  subTaskIssueTypeId: string;
}

/** Resolves the Story + Sub-task issue-type ids for a project via the create-meta issue-type list. */
async function resolveIssueTypeIds(projectKey: string): Promise<IssueTypeIds> {
  const response = await jiraGet<{ values?: Array<{ id: string; name: string; subtask?: boolean }> }>(
    `/rest/api/2/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`,
  );
  const types = response.values ?? [];
  const story = types.find((type) => /^story$/i.test(type.name)) ?? types.find((type) => !type.subtask);
  const subTask = types.find((type) => type.subtask === true) ?? types.find((type) => /sub-?task/i.test(type.name));
  return { storyIssueTypeId: story?.id ?? '', subTaskIssueTypeId: subTask?.id ?? '' };
}

/** The async-loaded inputs the planner needs beyond the store-backed roster/capacity. */
interface LoadedInputs {
  features: FeatureInput[];
  releaseSchedule: ReleaseSchedule;
  fieldIds: PiPlanFieldIds;
  issueTypeIds: IssueTypeIds;
}

/** The PI Planner tab: assembles live inputs, then renders the gated propose-only planner. */
export function PlannerTab({ boardId, projectKey, selectedPiName, teamProfileId }: PlannerTabProps): React.ReactElement {
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const capacityRows = useCapacityStore((state) => state.rows);
  const capacityStartDate = useCapacityStore((state) => state.startDate);
  const capacityEndDate = useCapacityStore((state) => state.endDate);

  const [loaded, setLoaded] = useState<(LoadedInputs & { piStartIso: string }) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Repo-only story generation (spec 031) — deterministic, NOT AI-gated. Its own proposal state, rendered
  // alongside (not inside) the AI planner panel.
  const [repoProposal, setRepoProposal] = useState<PlanProposal | null>(null);
  const [repoAcceptedIds, setRepoAcceptedIds] = useState<Set<string>>(new Set());
  const [repoDismissedIds, setRepoDismissedIds] = useState<Set<string>>(new Set());
  // US5 — mapping a Feature's repo components from the Planner (same allowlist-constrained, gated flow).
  const [mappingFeatureKey, setMappingFeatureKey] = useState('');
  const [mappingNames, setMappingNames] = useState<string[]>([]);
  const [mappingNote, setMappingNote] = useState<string | null>(null);
  const [isWritingMapping, setIsWritingMapping] = useState(false);

  // Scope the capacity store to this team (the roster store is already scoped by PoToolView).
  useEffect(() => {
    useCapacityStore.getState().setDashboardTeamProfileId(teamProfileId);
  }, [teamProfileId]);

  const piWindow = useMemo(() => {
    const range = parsePiDateRange(selectedPiName);
    return range ? { startIso: toIsoDate(range.startDate), endIso: toIsoDate(range.endDate) } : null;
  }, [selectedPiName]);

  const poAssigneeQueryValues = useMemo(
    () => rosterMembers.filter((member) => member.roleCapabilities?.canProductOwner === true).map((member) => member.assigneeQueryValue),
    [rosterMembers],
  );

  // Load the Jira-backed inputs whenever the PI, team, or project changes. State is only set from the
  // async resolution (never synchronously in the effect body) so there are no cascading renders.
  useEffect(() => {
    if (!piWindow) {
      return;
    }
    let isActive = true;
    (async () => {
      try {
        const pulled = await pullPiReviewFeatures(selectedPiName, poAssigneeQueryValues, []);
        const jiraIssueMap = await fetchPiReviewFeatureIssues(pulled.rows);
        const reconciled = reconcilePiReviewRowsWithJira(pulled.rows, jiraIssueMap);
        // Enrich each Feature with the repo components it carries (filtered to the current allowlist), so
        // repo-only story generation has its input (spec 031). Domain/unclassified components are dropped.
        const features = buildFeatureInputs(reconciled.rows, jiraIssueMap).map((feature) => ({
          ...feature,
          repoComponentNames: readRepoComponentNames(
            jiraIssueMap[feature.key.toUpperCase()] as FeatureIssueLike | undefined,
            getComponentKind,
          ),
        }));
        const versions = await fetchPiWindowFixVersions(projectKey);
        const releaseSchedule = buildReleaseSchedule(versions, piWindow.startIso, piWindow.endIso);
        const fieldIds = await resolvePiPlanFieldIds();
        const issueTypeIds = await resolveIssueTypeIds(projectKey);
        if (isActive) {
          setLoaded({ features, releaseSchedule, fieldIds, issueTypeIds, piStartIso: piWindow.startIso });
          setLoadError(null);
        }
      } catch (caught) {
        if (isActive) {
          setLoadError(`Could not load planner inputs: ${caught instanceof Error ? caught.message : String(caught)} (check VPN / Jira connectivity).`);
        }
      }
    })();
    return () => { isActive = false; };
  }, [piWindow, selectedPiName, projectKey, poAssigneeQueryValues]);

  const people = useMemo(() => {
    const summary = buildCapacitySummary(`${teamProfileId} capacity`, capacityRows, capacityStartDate, capacityEndDate);
    return buildPersonCapacities(rosterMembers, summary, DEFAULT_SPRINT_LENGTH_DAYS);
  }, [rosterMembers, capacityRows, capacityStartDate, capacityEndDate, teamProfileId]);

  const accountIdByDisplayName = useMemo(() => {
    const map: Record<string, string> = {};
    rosterMembers.forEach((member) => { if (member.jiraAccountId) map[member.displayName] = member.jiraAccountId; });
    return map;
  }, [rosterMembers]);

  async function handleApplyStory(item: PlanItemProposal): Promise<void> {
    if (!loaded || boardId == null) {
      return;
    }
    let story = item.payload as ScheduledStory;
    // A repo-driven Story's title ends with "(repo)"; resolve that repo to a component id so the created
    // Story carries its component (spec 031). Ordinary 028 stories have no such suffix and are unaffected.
    const repoMatch = /\(([^)]+)\)\s*$/.exec(story.summary);
    const repoName = repoMatch ? repoMatch[1].trim() : '';
    if (repoName !== '' && getComponentKind(repoName) === 'repo') {
      const { ids } = await resolveComponentIdsByName(projectKey, [repoName]);
      if (ids[0]) {
        story = { ...story, repoComponentId: ids[0].id };
      }
    }
    const itemToWrite: PlanItemProposal = { ...item, payload: story };
    const { idByName } = await ensureSprints(
      [{ name: story.sprintName, startIso: story.sprintStartIso, endIso: story.sprintEndIso }],
      boardId,
    );
    const writeContext: WriteContext = {
      projectKey,
      boardId,
      fieldIds: loaded.fieldIds,
      storyIssueTypeId: loaded.issueTypeIds.storyIssueTypeId,
      subTaskIssueTypeId: loaded.issueTypeIds.subTaskIssueTypeId,
      existingSprintIdByName: idByName,
      accountIdByDisplayName,
    };
    await applyStoryPlan(itemToWrite, writeContext);
  }

  /** Builds the deterministic one-Story-per-repo proposal (no AI), reusing the 028 schedule/date pipeline. */
  function handleGenerateRepoStories(): void {
    if (loaded == null || piWindow == null) {
      return;
    }
    const acceptedByFeature = buildRepoStoryAcceptedByFeature(loaded.features, getComponentKind);
    const nextProposal = buildPiPlanProposal({
      piName: selectedPiName,
      piStartIso: piWindow.startIso,
      piEndIso: piWindow.endIso,
      features: loaded.features,
      acceptedByFeature,
      people,
      releaseSchedule: loaded.releaseSchedule,
      workingCalendar: DEFAULT_WORKING_CALENDAR,
      sprintLengthDays: DEFAULT_SPRINT_LENGTH_DAYS,
    }, toIsoDate(new Date()));
    setRepoProposal(nextProposal);
    setRepoAcceptedIds(new Set());
    setRepoDismissedIds(new Set());
  }

  async function handleAcceptRepoStory(id: string): Promise<void> {
    const item = repoProposal?.items.find((candidate) => candidate.id === id && candidate.kind === 'story');
    if (item) {
      await handleApplyStory(item);
    }
    setRepoAcceptedIds((previous) => new Set(previous).add(id));
  }

  function handleDismissRepoStory(id: string): void {
    setRepoDismissedIds((previous) => new Set(previous).add(id));
  }

  /** Ingests a component-mapping reply for the selected Feature (US5). Writes nothing yet — stages names. */
  function handleMappingIngest(responseText: string): void {
    const key = mappingFeatureKey || loaded?.features[0]?.key || '';
    const feature = loaded?.features.find((candidate) => candidate.key === key);
    if (!feature) {
      return;
    }
    const { items, errors } = parseComponentMappingIngest(responseText, repoAllowlist());
    setMappingNames(items.map((item) => item.componentName));
    setMappingNote(
      errors.length > 0
        ? errors.join(' ')
        : items.length > 0
          ? `${items.length} repo(s) proposed for ${feature.key} — review, then write.`
          : 'No repo components proposed.',
    );
  }

  /** Writes the staged repo components to the selected Feature (unioned with existing), on explicit click. */
  async function handleWriteMapping(): Promise<void> {
    const key = mappingFeatureKey || loaded?.features[0]?.key || '';
    if (key === '' || mappingNames.length === 0) {
      return;
    }
    setIsWritingMapping(true);
    try {
      await addIssueComponentsByName(key, mappingNames);
      setMappingNote(`Wrote ${mappingNames.length} repo component(s) to ${key}.`);
      setMappingNames([]);
    } catch (caught) {
      setMappingNote(`Could not write components: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsWritingMapping(false);
    }
  }

  if (!piWindow) {
    return (
      <div className="pi-plan-status" role="status">
        The selected PI (&quot;{selectedPiName}&quot;) has no start/end dates in its name — the planner needs a dated PI.
      </div>
    );
  }
  const isReady = loaded != null && loaded.piStartIso === piWindow.startIso;
  if (loadError && !isReady) {
    return <div className="pi-plan-status" role="status">{loadError}</div>;
  }
  if (!isReady) {
    return <div className="pi-plan-status" role="status">Loading planner inputs…</div>;
  }
  if (loaded!.features.length === 0) {
    return <div className="pi-plan-status" role="status">No Features found for this PI and Product Owner — nothing to plan yet.</div>;
  }

  const promptContext = assemblePromptContext({
    piName: selectedPiName,
    piStartIso: piWindow.startIso,
    piEndIso: piWindow.endIso,
    sprints: deriveSprints(piWindow.startIso, piWindow.endIso, DEFAULT_SPRINT_LENGTH_DAYS),
    workingCalendar: DEFAULT_WORKING_CALENDAR,
    people,
    features: loaded!.features,
    releaseSchedule: loaded!.releaseSchedule,
  });

  const decoratedRepoItems = (repoProposal?.items ?? []).map((item) => ({
    ...item,
    status: repoAcceptedIds.has(item.id) ? 'accepted' : repoDismissedIds.has(item.id) ? 'dismissed' : item.status,
  } as PlanItemProposal));

  const effectiveMappingKey = mappingFeatureKey || loaded!.features[0]?.key || '';
  const mappingFeature = loaded!.features.find((feature) => feature.key === effectiveMappingKey);
  const mappingPrompt = mappingFeature
    ? buildComponentMappingPrompt({ key: mappingFeature.key, summary: mappingFeature.summary, description: '' }, repoAllowlist())
    : '';

  return (
    <>
      {/* US5 — map a Feature's repo components from the Planner (gated ReportAiPanel, same allowlist rules). */}
      <section className="pi-plan-repo-mapping" aria-label="Map repo components">
        <label htmlFor="planner-map-feature">Feature to map</label>
        <select
          id="planner-map-feature"
          value={effectiveMappingKey}
          onChange={(changeEvent) => { setMappingFeatureKey(changeEvent.target.value); setMappingNames([]); setMappingNote(null); }}
        >
          {loaded!.features.map((feature) => (
            <option key={feature.key} value={feature.key}>{feature.key} — {feature.summary}</option>
          ))}
        </select>
        <ReportAiPanel
          title="🧩 Map repo components"
          prompt={mappingPrompt}
          ingestLabel="Read the reply"
          onIngest={handleMappingIngest}
          error={mappingNote}
          hint="Proposes repo components for this Feature from your classified repo list. Accepted repos are written to the Feature (unioned with existing, never AI-attributed)."
        >
          {mappingNames.length > 0 ? (
            <div className="pi-plan-results">
              <p>Proposed: {mappingNames.join(', ')}</p>
              <button type="button" disabled={isWritingMapping} onClick={handleWriteMapping}>
                {isWritingMapping ? 'Writing…' : `Write ${mappingNames.length} to ${effectiveMappingKey}`}
              </button>
            </div>
          ) : null}
        </ReportAiPanel>
      </section>

      {/* Repo-only story generation (spec 031) — deterministic, one Story per repo component, not AI. */}
      <section className="pi-plan-repo-stories" aria-label="Repo story generation">
        <p className="pi-plan-status">
          Generate one Story per repo component on each Feature. Repos come from the Feature&apos;s components
          (map them in Feature Composition first); domain and unclassified components never become a story.
        </p>
        <button type="button" className="pi-plan-generate-repo-stories" onClick={handleGenerateRepoStories}>
          Generate repo stories
        </button>
        {repoProposal ? (
          <div className="pi-plan-results">
            {repoProposal.honestStates.length > 0 ? (
              <ul className="pi-plan-honest-states">
                {repoProposal.honestStates.map((state) => <li key={state}>{state}</li>)}
              </ul>
            ) : null}
            <PlanProposalTable items={decoratedRepoItems} onAccept={handleAcceptRepoStory} onDismiss={handleDismissRepoStory} />
          </div>
        ) : null}
      </section>

      <PiPlanPanel
        promptContext={promptContext}
        features={loaded!.features}
        people={people}
        releaseSchedule={loaded!.releaseSchedule}
        workingCalendar={DEFAULT_WORKING_CALENDAR}
        piName={selectedPiName}
        piStartIso={piWindow.startIso}
        piEndIso={piWindow.endIso}
        sprintLengthDays={DEFAULT_SPRINT_LENGTH_DAYS}
        todayIso={toIsoDate(new Date())}
        onApplyStory={handleApplyStory}
      />
    </>
  );
}
