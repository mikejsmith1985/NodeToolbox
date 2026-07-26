// PlannerTab.tsx — The live mount of the PI Planner on the PO Tool surface (spec 028, US1, T024).
// It gathers the planner's inputs from the SAME reused sources PI Review uses — roster, capacity, the
// Feature pull, fixVersions, PI dates, board/project — assembles the prompt context, and renders the
// gated PiPlanPanel. The write path ensures the target sprint exists, then delegates to applyStoryPlan.
// Additive only: this file touches no host logic; PoToolView just renders it behind a new tab.

import React, { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
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
import { buildFeatureInputs, deriveSprints, toIsoDate } from './plannerInputs.ts';
import type { FeatureInput, PlanItemProposal, ReleaseSchedule, ScheduledStory, WorkingCalendar } from './piPlanTypes.ts';

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
        const features = buildFeatureInputs(reconciled.rows, jiraIssueMap);
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
    const story = item.payload as ScheduledStory;
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
    await applyStoryPlan(item, writeContext);
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

  return (
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
  );
}
