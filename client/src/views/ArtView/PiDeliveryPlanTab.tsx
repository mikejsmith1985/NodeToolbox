// PiDeliveryPlanTab.tsx — The PI Delivery Planner tab (spec 032, US1). Drives the full propose-only pipeline:
// load committed Features → assemble the deterministic PI Planning Fact Sheet → generate ONE AI prompt →
// paste the reply → ingest (allowlist-rejecting unknown repos/keys) → build the delivery plan (repo→sub-task
// with parallel per-repo assignment and rule-derived dates) → flag bottlenecks → per-item accept writes.
// All dates/capacity/assignment/bottlenecks are engine-computed; nothing is trusted from the AI reply.

import { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { getComponentKind } from '../AdminHub/lib/componentClassificationStore.ts';
import { useStandupRosterStore } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { parsePiDateRange } from '../FeatureCanvas/logic/piSchedule.ts';
import { loadHygieneFieldConfig } from '../Hygiene/checks/hygieneFieldConfig.ts';
import type { JiraIssue } from '../../types/jira.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { importCommittedPiReviewFeatureKeys } from '../PoTool/rewrite/importPiReviewFeatures.ts';
import { resolvePiPlanFieldIds, resolveDeliveryIssueTypeIds } from './piPlan/piPlanFields.ts';
import { assembleFactSheet } from './piPlan/piPlanFactSheet.ts';
import { buildDeliveryPlanPrompt } from './piPlan/ai/deliveryPlanPrompt.ts';
import { parseDeliveryPlanReply } from './piPlan/ai/deliveryPlanIngest.ts';
import { buildDeliveryPlan, type AcceptedStory, type CarryoverWipItem, type DeliveryPlan, type PlannedStory } from './piPlan/piDeliveryEngine.ts';
import { detectBottlenecks, attachMitigations } from './piPlan/piPlanBottlenecks.ts';
import { applyDeliveryStory, applyCarryoverGaps, type DeliveryWriteContext } from './piPlan/piDeliveryJira.ts';
import { toFactSheetFeatureInputs, toFactSheetPersonInputs, deriveSprints, versionsToReleaseSchedule, type JiraProjectVersion } from './piPlan/piDeliveryTabData.ts';
import { classifyChildKind, reconcileCarryoverFeature, type CarryoverStory, type CarryoverStoryReconcile } from './piPlan/piPlanCarryover.ts';
import { detectDefectUndersize, type DefectUndersizeFlag } from './piPlan/piPlanCapacityFlags.ts';
import { buildStorySubtaskScaffold } from './piPlan/piPlanRepoSubtasks.ts';
import PiDeliveryMonitor from './PiDeliveryMonitor.tsx';
import type { Bottleneck, ExistingChild, PiPlanningFactSheet } from './piPlan/piPlanTypes.ts';
import styles from './PiDeliveryPlanTab.module.css';

const DEFAULT_SIZE_FIELD_ID = 'customfield_10002';
const PI_SPRINT_COUNT = 5;
const WORKING_CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] as string[] };
const FEATURE_FIELDS = ['summary', 'description', 'priority', 'components', 'fixVersions', 'issuelinks'];

interface PiDeliveryPlanTabProps {
  /** The PI selected in the ART header (source of the Feature query + sprint window). */
  piName: string;
  /** The ART teams — the first with a project key seeds the write project (auto-wire). */
  teams?: ArtTeam[];
}

/** Today as YYYY-MM-DD, for the injected planning clock (browser context — Date is available here). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Splits a Feature's size across the Stories the AI grouped for it, at least 1 point each. */
function sizePerStory(featureSize: number | null, storyCount: number): number {
  const base = featureSize && featureSize > 0 ? featureSize : storyCount;
  return Math.max(1, Math.round(base / Math.max(1, storyCount)));
}

/** Reads a Story's parent-Feature key from its Feature-link field (string key or `{ key }` object). */
function readFeatureLinkValue(issue: JiraIssue, featureLinkFieldId: string): string | null {
  const raw = (issue.fields as unknown as Record<string, unknown>)[featureLinkFieldId];
  if (typeof raw === 'string' && raw.includes('-')) return raw;
  if (raw && typeof raw === 'object') return (raw as { key?: string }).key ?? null;
  return null;
}

/** The outcome of committing one staged review item (a new Story, or a gap-fill on an existing Story). */
interface CommitResult {
  id: string;
  label: string;
  status: 'success' | 'failed';
  message: string;
}

/** Stable review-item id for a carryover / on-demand gap-fill (distinct from a new Story's tempId). */
function carryoverItemId(storyKey: string): string {
  return `carryover:${storyKey}`;
}

/** The PI Delivery Planner: one place to generate, review, and commit a whole-PI delivery plan. */
export default function PiDeliveryPlanTab({ piName, teams = [] }: PiDeliveryPlanTabProps) {
  const isAiUnlocked = useAiAssistStore((store) => store.isAiAssistUnlocked);
  const rosterMembers = useStandupRosterStore((store) => store.rosterMembers);

  // ── Config the operator confirms before a pull (prefilled with safe defaults) ──
  const [sizeFieldId, setSizeFieldId] = useState(DEFAULT_SIZE_FIELD_ID);
  const [piStartIso, setPiStartIso] = useState('');
  const [piEndIso, setPiEndIso] = useState('');
  // The project whose fixVersions define the release schedule — often the write project, but a team's
  // releases can live in a separate (portfolio/program) project, so it is independently overridable.
  const [releaseProjectKey, setReleaseProjectKey] = useState('');
  // The team whose PI Review page supplies the committed Feature set (the authoritative source).
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const teamsWithPages = useMemo(() => teams.filter((team) => (team.piReviewPages ?? []).length > 0), [teams]);
  // A prominent line stating exactly where the loaded Features came from (which page, how many committed).
  const [loadSource, setLoadSource] = useState('');

  // ── Pipeline state ──
  const [factSheet, setFactSheet] = useState<PiPlanningFactSheet | null>(null);
  const [componentIdByName, setComponentIdByName] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<string[]>([]);
  const [hasCopiedPrompt, setHasCopiedPrompt] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [plan, setPlan] = useState<DeliveryPlan | null>(null);
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  // Carryover reconciliation: in-flight Stories and the sub-tasks they are missing (gap-fill, never duplicated).
  const [carryover, setCarryover] = useState<{ featureKey: string; reconcile: CarryoverStoryReconcile }[]>([]);
  // In-flight carryover work that pre-consumes sprint capacity (Phase B), fed to the engine at ingest.
  const [carryoverWip, setCarryoverWip] = useState<CarryoverWipItem[]>([]);
  // Phase C — on-demand defect sub-task generation (defects are unplanned; append repos as you build them).
  const [defectKey, setDefectKey] = useState('');
  // The planning capacity per person per sprint (8/10/13) — sets everyone's sprint capacity AND the max Story size.
  const [capacityPerSprint, setCapacityPerSprint] = useState(10);
  // Defect-bucket Features whose child issues have outgrown their point budget (computed at load).
  const [defectFlags, setDefectFlags] = useState<DefectUndersizeFlag[]>([]);
  // ── Staging (Option B) — nothing writes to Jira until the single "Commit all" gate. `excludedItemIds` are the
  // review items the operator has UNticked; `commitResults` holds the outcome of the last commit for display.
  const [excludedItemIds, setExcludedItemIds] = useState<Set<string>>(new Set());
  const [commitResults, setCommitResults] = useState<CommitResult[] | null>(null);
  // Field id → human display name, so the config inputs show what each field id actually is.
  const [fieldNameById, setFieldNameById] = useState<Record<string, string>>({});
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // ── Optional write config (accept is disabled until the essentials are present) ──
  const [writeConfig, setWriteConfig] = useState({ projectKey: '', storyIssueTypeId: '', subTaskIssueTypeId: '', featureLink: '', targetStart: '', targetEnd: '' });
  const isWriteConfigured = writeConfig.projectKey !== '' && writeConfig.storyIssueTypeId !== '' && writeConfig.subTaskIssueTypeId !== '';

  const rosterDevNames = useMemo(
    () => rosterMembers.filter((member) => member.roleCapabilities?.canDevelop || member.roleCapabilities?.canInternalTest).map((member) => member.displayName),
    [rosterMembers],
  );

  // ── Auto-wire the config from the PI name, the roster, the teams, and the connected instance ──
  // Every setter is only-if-empty so an operator override is never clobbered.

  // Default the source team to the first one with a PI Review page.
  useEffect(() => {
    if (selectedTeamId === '' && teamsWithPages.length > 0) {
      setSelectedTeamId(teamsWithPages[0].id);
    }
  }, [teamsWithPages, selectedTeamId]);

  // PI start/end derive from the PI name when it encodes dates — refreshed whenever the PI changes (the PI
  // name is authoritative for its dates, so a stale prior-PI range is never left behind).
  useEffect(() => {
    const range = parsePiDateRange(piName);
    if (range) {
      setPiStartIso(range.startIso);
      setPiEndIso(range.endIso);
    }
  }, [piName]);

  // Write project key from the first team that has one.
  useEffect(() => {
    const teamProjectKey = teams.find((team) => (team.projectKey ?? '').trim() !== '')?.projectKey?.trim();
    if (teamProjectKey) {
      setWriteConfig((previous) => (previous.projectKey ? previous : { ...previous, projectKey: teamProjectKey }));
      // Default the release-schedule project to the team project; the operator overrides it when releases
      // live in a separate portfolio/program project.
      setReleaseProjectKey((previous) => previous || teamProjectKey);
    }
  }, [teams]);

  // Discover the size field, the write field ids, and the Story/Sub-task issue-type ids from the instance (once).
  useEffect(() => {
    let isActive = true;
    void (async () => {
      try {
        const [hygiene, fieldIds, issueTypeIds] = await Promise.all([
          loadHygieneFieldConfig(), resolvePiPlanFieldIds(), resolveDeliveryIssueTypeIds(),
        ]);
        if (!isActive) return;
        const estimateFieldId = hygiene.estimateFieldIds?.[0];
        if (estimateFieldId) {
          setSizeFieldId((previous) => (previous === DEFAULT_SIZE_FIELD_ID ? estimateFieldId : previous));
        }
        setWriteConfig((previous) => ({
          ...previous,
          featureLink: previous.featureLink || fieldIds.featureLink,
          targetStart: previous.targetStart || fieldIds.targetStart,
          targetEnd: previous.targetEnd || fieldIds.targetEnd,
          storyIssueTypeId: previous.storyIssueTypeId || issueTypeIds.storyIssueTypeId,
          subTaskIssueTypeId: previous.subTaskIssueTypeId || issueTypeIds.subTaskIssueTypeId,
        }));
        // Field id → display name, so the config inputs can show what each field actually is.
        const allFields = await jiraGet<{ id: string; name: string }[]>('/rest/api/2/field');
        if (!isActive) return;
        const nameById: Record<string, string> = {};
        (Array.isArray(allFields) ? allFields : []).forEach((field) => { if (field.id && field.name) nameById[field.id] = field.name; });
        setFieldNameById(nameById);
      } catch {
        // Leave defaults in place — the operator can fill any missing field manually.
      }
    })();
    return () => { isActive = false; };
  }, []);

  async function handleLoadFeatures() {
    if (piName.trim() === '') {
      setStatusMessage('Select a PI before loading Features.');
      return;
    }
    setIsBusy(true);
    setStatusMessage('');
    try {
      const fields = [...FEATURE_FIELDS, sizeFieldId].join(',');
      let issues: JiraIssue[] = [];

      // The committed Feature set comes ONLY from the selected team's PI Review page — the single authoritative
      // source. No Jira PO+PI fallback: if the page can't be read, we say so rather than quietly returning a
      // different (PO-scoped) set.
      const sourceTeam = teams.find((team) => team.id === selectedTeamId)
        ?? teams.find((team) => (team.piReviewPages ?? []).length > 0);
      if (!sourceTeam) {
        setLoadSource('');
        setStatusMessage('No team has a PI Review page configured. Set the team\'s PI Review page (in Team Dashboard) for this PI, then reload.');
        return;
      }
      const committed = await importCommittedPiReviewFeatureKeys(sourceTeam, piName);
      if (committed.blockedReason !== null) {
        setLoadSource('');
        setStatusMessage(`${sourceTeam.name} has no PI Review page configured for "${piName}". Add it in Team Dashboard, then reload.`);
        return;
      }
      if (committed.keys.length > 0) {
        const keyJql = `issuekey in (${committed.keys.join(', ')})`;
        const keyPath = `/rest/api/2/search?jql=${encodeURIComponent(keyJql)}&fields=${encodeURIComponent(fields)}&maxResults=300`;
        issues = (await jiraGet<{ issues?: JiraIssue[] }>(keyPath)).issues ?? [];
      }
      const missingFromJira = committed.keys.length - issues.length;
      setLoadSource(`Source: ${sourceTeam.name}'s PI Review page — ${committed.keys.length} committed Feature(s)${missingFromJira > 0 ? `, ⚠ ${missingFromJira} not found in Jira` : ''}.`);
      // Capture component name→id from the fetched Features so coding sub-tasks can carry a real component id.
      const idByName: Record<string, string> = {};
      issues.forEach((issue) => {
        const rawComponents = (issue.fields as unknown as { components?: unknown }).components;
        (Array.isArray(rawComponents) ? rawComponents : []).forEach((component) => {
          const named = component as { id?: string; name?: string };
          if (named.name && named.id) idByName[named.name] = named.id;
        });
      });
      // ── Carryover detection: fetch each Feature's existing Stories (+ their sub-tasks) so in-flight work is
      // RECONCILED, not regenerated. Needs the Feature-link field id (auto-wired in Write settings); without it
      // carryover cannot be detected and re-planning would risk duplicates, so we say so.
      const existingChildrenByFeature: Record<string, ExistingChild[]> = {};
      const carryoverReconciles: { featureKey: string; reconcile: CarryoverStoryReconcile }[] = [];
      // Summed points of every child issue per Feature (done + not-done) — the defect-bucket budget check.
      const childPointsByFeature: Record<string, number> = {};
      let wipItems: CarryoverWipItem[] = [];
      const featureLinkFieldId = writeConfig.featureLink.trim();
      let carryoverNote = '';
      if (featureLinkFieldId === '') {
        carryoverNote = ' ⚠ No Feature-link field id set — carryover cannot be detected; set it in Write settings before accepting.';
      } else if (issues.length > 0) {
        const fieldNumber = featureLinkFieldId.replace('customfield_', '');
        const storyJql = `cf[${fieldNumber}] in (${issues.map((issue) => issue.key).join(', ')}) AND issuetype in (Story, Defect)`;
        const storyFields = `summary,components,status,${sizeFieldId},${featureLinkFieldId}`;
        const storyPath = `/rest/api/2/search?jql=${encodeURIComponent(storyJql)}&fields=${encodeURIComponent(storyFields)}&maxResults=300`;
        const stories = (await jiraGet<{ issues?: JiraIssue[] }>(storyPath)).issues ?? [];
        // Each in-flight (not-done) Story's remaining effort consumes capacity (Phase B).
        wipItems = stories.map((story) => {
          const rawSize = (story.fields as unknown as Record<string, unknown>)[sizeFieldId];
          const sizePoints = typeof rawSize === 'number' ? rawSize : Number(rawSize) || 0;
          return {
            summary: typeof story.fields?.summary === 'string' ? story.fields.summary : story.key,
            sizePoints,
            isDone: story.fields?.status?.statusCategory?.key === 'done',
          };
        }).filter((wip) => !wip.isDone && wip.sizePoints > 0);

        // The Stories' existing sub-tasks tell gap-fill what already exists.
        const subtasksByStory: Record<string, ExistingChild[]> = {};
        if (stories.length > 0) {
          const subJql = `parent in (${stories.map((story) => story.key).join(', ')})`;
          const subPath = `/rest/api/2/search?jql=${encodeURIComponent(subJql)}&fields=${encodeURIComponent('summary,parent')}&maxResults=800`;
          (await jiraGet<{ issues?: JiraIssue[] }>(subPath)).issues?.forEach((subtask) => {
            const parentKey = (subtask.fields as unknown as { parent?: { key?: string } }).parent?.key;
            const summary = typeof subtask.fields?.summary === 'string' ? subtask.fields.summary : '';
            if (!parentKey) return;
            (subtasksByStory[parentKey] ??= []).push({ key: subtask.key, kind: classifyChildKind(summary), parentKey, summary });
          });
        }

        // Group Stories under their parent Feature; capture repos + component ids off the Stories too.
        const carryoverStoriesByFeature: Record<string, CarryoverStory[]> = {};
        stories.forEach((story) => {
          const parentFeatureKey = readFeatureLinkValue(story, featureLinkFieldId);
          if (!parentFeatureKey) return;
          const rawStorySize = (story.fields as unknown as Record<string, unknown>)[sizeFieldId];
          const storyPoints = typeof rawStorySize === 'number' ? rawStorySize : Number(rawStorySize) || 0;
          childPointsByFeature[parentFeatureKey] = (childPointsByFeature[parentFeatureKey] ?? 0) + storyPoints;
          const storyComponents = (story.fields as unknown as { components?: { id?: string; name?: string }[] }).components ?? [];
          storyComponents.forEach((component) => { if (component.name && component.id) idByName[component.name] = component.id; });
          const repoNames = storyComponents.map((component) => component.name ?? '').filter((name) => name !== '' && getComponentKind(name) === 'repo');
          const summary = typeof story.fields?.summary === 'string' ? story.fields.summary : story.key;
          (existingChildrenByFeature[parentFeatureKey] ??= []).push({ key: story.key, kind: 'story', parentKey: parentFeatureKey, summary });
          (carryoverStoriesByFeature[parentFeatureKey] ??= []).push({ key: story.key, summary, repoNames, existingChildren: subtasksByStory[story.key] ?? [] });
        });

        // Reconcile each carryover Feature into gap-fill proposals (missing sub-tasks only).
        Object.entries(carryoverStoriesByFeature).forEach(([featureKey, featureStories]: [string, CarryoverStory[]]) => {
          reconcileCarryoverFeature(featureStories, (repoName) => idByName[repoName] ?? null)
            .forEach((reconcile) => carryoverReconciles.push({ featureKey, reconcile }));
        });
      }
      setComponentIdByName(idByName);
      setCarryover(carryoverReconciles);
      setCarryoverWip(wipItems);

      // Determine the release schedule from the project's fixVersions, so the process sets the correct
      // fixVersion per Story (its PROD/Due lands on the first release on/after it) rather than trusting a
      // Feature's fixVersion that may be unset at load. Empty → the engine falls back to a monthly suggestion.
      let releaseSchedule = { entries: [] as ReturnType<typeof versionsToReleaseSchedule>['entries'] };
      const versionProjectKey = releaseProjectKey.trim() || writeConfig.projectKey.trim();
      if (versionProjectKey !== '') {
        try {
          const versions = await jiraGet<JiraProjectVersion[]>(`/rest/api/2/project/${encodeURIComponent(versionProjectKey)}/versions`);
          releaseSchedule = versionsToReleaseSchedule(Array.isArray(versions) ? versions : []);
        } catch {
          // Leave the schedule empty — the date engine still proposes a monthly cadence.
        }
      }

      const start = piStartIso.trim() || todayIso();
      const end = piEndIso.trim() || start;
      const sprints = deriveSprints(start, end, PI_SPRINT_COUNT, piName);
      const sheet = assembleFactSheet({
        piName, piStartIso: start, sprints,
        features: toFactSheetFeatureInputs(issues, sizeFieldId, {}, existingChildrenByFeature),
        people: toFactSheetPersonInputs(rosterMembers),
        releaseSchedule,
        fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] },
        classifyComponent: (name) => getComponentKind(name) ?? 'unclassified',
        capacityPerSprintOverride: capacityPerSprint, // plan at the selected 8/10/13 pts per person per sprint
      });
      setFactSheet(sheet);
      setPlan(null);
      setBottlenecks([]);
      setPrompts([]);
      // Flag any Defect-bucket Feature whose child issues have outgrown its point budget (undersized).
      const undersized = detectDefectUndersize(sheet.features, childPointsByFeature);
      setDefectFlags(undersized);
      const carryoverFeatureCount = sheet.features.filter((feature) => feature.isCarryover).length;
      const undersizedNote = undersized.length > 0 ? ` ⚠ ${undersized.length} defect Feature(s) over budget.` : '';
      setStatusMessage(`Loaded ${issues.length} Feature(s) — ${carryoverFeatureCount} carryover (reconciled), ${issues.length - carryoverFeatureCount} new. ${sheet.repoAllowlist.length} repo(s).${carryoverNote}${undersizedNote}`);
    } catch (loadError) {
      setStatusMessage(loadError instanceof Error ? loadError.message : 'Failed to load Features.');
    } finally {
      setIsBusy(false);
    }
  }

  function handleGeneratePrompt() {
    if (factSheet === null) return;
    const built = buildDeliveryPlanPrompt(factSheet, bottlenecks, capacityPerSprint);
    setPrompts(built.prompts);
    setHasCopiedPrompt(false);
    setStatusMessage(`Prompt generated (${built.featureCount} Features${built.chunkCount > 1 ? `, ${built.chunkCount} chunks` : ''}). Copy it into your AI, then paste the reply below.`);
  }

  // Copies the full generated prompt (all chunks) to the clipboard, matching the app's
  // "📋 Copy prompt" affordance used on the other AI-assist panels.
  async function handleCopyPrompt(): Promise<void> {
    if (prompts.length === 0) return;
    try {
      await navigator.clipboard.writeText(prompts.join('\n\n=== NEXT CHUNK ===\n\n'));
      setHasCopiedPrompt(true);
    } catch {
      setHasCopiedPrompt(false);
      setStatusMessage('Could not copy to clipboard — select the text and copy manually.');
    }
  }

  function handleIngest() {
    if (factSheet === null) return;
    const parsed = parseDeliveryPlanReply(replyText, factSheet, bottlenecks);
    if (parsed.error) {
      setStatusMessage(parsed.error);
      return;
    }
    // Split each Feature's size across the Stories the AI grouped for it.
    const storyCountByFeature: Record<string, number> = {};
    parsed.stories.forEach((story) => { storyCountByFeature[story.featureKey] = (storyCountByFeature[story.featureKey] ?? 0) + 1; });
    const sizeByFeature = new Map(factSheet.features.map((feature) => [feature.key, feature.sizePoints]));
    const acceptedStories: AcceptedStory[] = parsed.stories.map((story) => ({
      featureKey: story.featureKey, summary: story.summary, repoNames: story.repos,
      sizePoints: sizePerStory(sizeByFeature.get(story.featureKey) ?? null, storyCountByFeature[story.featureKey]),
    }));

    const builtPlan = buildDeliveryPlan({
      factSheet, stories: acceptedStories,
      resolveComponentId: (repoName) => componentIdByName[repoName] ?? null,
      workingCalendar: WORKING_CALENDAR, piEndIso: piEndIso.trim() || factSheet.deliveryDeadlineIso, todayIso: todayIso(),
      carryoverWip, // Phase B — in-flight work pre-consumes capacity so new work isn't over-scheduled on top of WIP.
    });
    const detected = attachMitigations(
      detectBottlenecks(builtPlan.planResult, factSheet, builtPlan.stories, piEndIso.trim() || factSheet.deliveryDeadlineIso, capacityPerSprint),
      parsed.mitigationsById,
    );
    setPlan(builtPlan);
    setBottlenecks(detected);
    setExcludedItemIds(new Set()); // fresh plan → everything staged (included) by default
    setCommitResults(null);
    const rejectedNote = parsed.rejected.length > 0 ? ` (${parsed.rejected.length} item(s) rejected)` : '';
    setStatusMessage(`Ingested ${builtPlan.stories.length} Story(ies); ${detected.length} bottleneck(s) flagged${rejectedNote}. Review below, then Commit all to Jira.`);
  }

  /** Toggles whether a review item is included in the commit set (unticked = held back, never written). */
  function toggleItemIncluded(itemId: string) {
    setExcludedItemIds((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  /** The write context shared by every commit (project + issue-type + field ids from Write settings). */
  function buildWriteContext(): DeliveryWriteContext {
    return {
      projectKey: writeConfig.projectKey, storyIssueTypeId: writeConfig.storyIssueTypeId,
      subTaskIssueTypeId: writeConfig.subTaskIssueTypeId,
      fieldIds: { featureLink: writeConfig.featureLink, targetStart: writeConfig.targetStart, targetEnd: writeConfig.targetEnd },
    };
  }

  // The staged items that are currently ticked for commit (new Stories + carryover/defect gap-fills).
  const includedStories = (plan?.stories ?? []).filter((story) => !excludedItemIds.has(story.tempId));
  const includedCarryover = carryover.filter((item) => !excludedItemIds.has(carryoverItemId(item.reconcile.storyKey)));
  const commitItemCount = includedStories.length + includedCarryover.length;

  /**
   * The single write gate (Option B): creates every ticked new Story (parent-first, with its sub-tasks) and
   * fills every ticked carryover/defect gap — NOTHING is written to Jira before this runs. Successful items are
   * removed from the review so a second click cannot duplicate them; failures stay for retry.
   */
  async function handleCommitAll() {
    if (!isWriteConfigured) {
      setStatusMessage('Set the project key and Story/Sub-task issue-type ids in Write settings before committing.');
      return;
    }
    setIsBusy(true);
    const context = buildWriteContext();
    const results: CommitResult[] = [];
    try {
      for (const story of includedStories) {
        try {
          const written = await applyDeliveryStory(withOverrides(story), context);
          results.push({ id: story.tempId, label: story.summary, status: 'success', message: `Story ${written.storyKey} + ${story.codingSubtasks.length} coding + SL + deploys` });
        } catch (writeError) {
          results.push({ id: story.tempId, label: story.summary, status: 'failed', message: writeError instanceof Error ? writeError.message : 'write failed' });
        }
      }
      for (const item of includedCarryover) {
        const itemId = carryoverItemId(item.reconcile.storyKey);
        try {
          const filled = await applyCarryoverGaps(item.reconcile.storyKey, item.reconcile.gapSubtasks, context);
          results.push({ id: itemId, label: item.reconcile.storySummary, status: 'success', message: `${filled.createdCount} sub-task(s) on ${item.reconcile.storyKey}` });
        } catch (writeError) {
          results.push({ id: itemId, label: item.reconcile.storySummary, status: 'failed', message: writeError instanceof Error ? writeError.message : 'gap-fill failed' });
        }
      }
      // Drop successfully-written items so the review can't re-commit (create is NOT idempotent for new Stories).
      const succeeded = new Set(results.filter((result) => result.status === 'success').map((result) => result.id));
      setPlan((previous) => (previous ? { ...previous, stories: previous.stories.filter((story) => !succeeded.has(story.tempId)) } : previous));
      setCarryover((previous) => previous.filter((item) => !succeeded.has(carryoverItemId(item.reconcile.storyKey))));
      setCommitResults(results);
      const okCount = results.filter((result) => result.status === 'success').length;
      const failCount = results.length - okCount;
      setStatusMessage(`Committed ${okCount} item(s) to Jira${failCount > 0 ? `, ${failCount} failed (kept for retry)` : ''}.`);
    } finally {
      setIsBusy(false);
    }
  }

  /** Applies the operator's assignee override to a coding sub-task before writing. */
  function withOverrides(story: PlannedStory): PlannedStory {
    return {
      ...story,
      codingSubtasks: story.codingSubtasks.map((coding) => {
        const override = assigneeOverrides[`${story.tempId}:${coding.repoName}`];
        return override ? { ...coding, assignee: override } : coding;
      }),
    };
  }

  /**
   * Phase C — stages the repo→sub-task scaffold for a single unplanned Defect: reads the Defect's impacted repo
   * components and existing sub-tasks, computes only the MISSING coding sub-tasks (one per repo) + SL + deploys,
   * and ADDS them to the commit set as a gap-fill item. Nothing is written until "Commit all to Jira".
   */
  async function handleGenerateDefectSubtasks() {
    if (!isWriteConfigured) {
      setStatusMessage('Set the project key and Story/Sub-task issue-type ids in Write settings first.');
      return;
    }
    const key = defectKey.trim();
    if (key === '') {
      setStatusMessage('Enter a Defect key.');
      return;
    }
    setIsBusy(true);
    try {
      const defect = await jiraGet<JiraIssue>(`/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,components`);
      const rawComponents = (defect.fields as unknown as { components?: { id?: string; name?: string }[] }).components ?? [];
      const idByName: Record<string, string> = { ...componentIdByName };
      rawComponents.forEach((component) => { if (component.name && component.id) idByName[component.name] = component.id; });
      const repoNames = rawComponents.map((component) => component.name ?? '').filter((name) => name !== '' && getComponentKind(name) === 'repo');
      if (repoNames.length === 0) {
        setStatusMessage(`${key} has no repo components — tag the impacted repos on the Defect first, then generate.`);
        return;
      }
      // Read existing sub-tasks so gap-fill only writes what is missing (idempotent).
      const existingSubtasks = (await jiraGet<{ issues?: JiraIssue[] }>(
        `/rest/api/2/search?jql=${encodeURIComponent(`parent = ${key}`)}&fields=${encodeURIComponent('summary')}&maxResults=200`,
      )).issues ?? [];
      const existingChildren: ExistingChild[] = existingSubtasks.map((subtask) => {
        const summary = typeof subtask.fields?.summary === 'string' ? subtask.fields.summary : '';
        return { key: subtask.key, kind: classifyChildKind(summary), parentKey: key, summary };
      });
      const defectSummary = typeof defect.fields?.summary === 'string' ? defect.fields.summary : key;
      const gaps = buildStorySubtaskScaffold({ summary: defectSummary, devPoints: repoNames.length }, repoNames, (repoName) => idByName[repoName] ?? null, existingChildren);
      if (gaps.length === 0) {
        setStatusMessage(`${key} is already fully scaffolded — nothing to add.`);
        return;
      }
      // Stage the defect's gaps as a commit item (deduped by key) — written only at "Commit all to Jira".
      setComponentIdByName(idByName);
      setCarryover((previous) => [
        ...previous.filter((item) => item.reconcile.storyKey !== key),
        { featureKey: key, reconcile: { storyKey: key, storySummary: defectSummary, gapSubtasks: gaps } },
      ]);
      setDefectKey('');
      setStatusMessage(`Staged ${gaps.length} sub-task(s) for ${key} (${repoNames.length} repo(s)) — commit below to write.`);
    } catch (defectError) {
      setStatusMessage(defectError instanceof Error ? defectError.message : 'Defect sub-task staging failed.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className={styles.deliveryTab}>
      {/* ── Load ── */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>1 · Load committed Features & build the fact sheet</h3>
        <p className={styles.statusLine}>PI: <strong>{piName || '(none selected)'}</strong>. Fields below auto-fill from the roster, the PI name, and the connected instance — override any of them. The fact sheet is the anti-hallucination spine.</p>
        <div className={styles.controlRow}>
          {teamsWithPages.length > 0 && (
            <label className={styles.field}>Team (PI Review page = committed source)
              <select className={styles.fieldInput} value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                {teamsWithPages.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
          )}
          <label className={styles.field}>Size field id
            <input className={styles.fieldInput} value={sizeFieldId} onChange={(event) => setSizeFieldId(event.target.value)} />
            {fieldNameById[sizeFieldId] && <span className={styles.statusLine}>{fieldNameById[sizeFieldId]}</span>}
          </label>
          <label className={styles.field}>PI start (YYYY-MM-DD)
            <input className={styles.fieldInput} value={piStartIso} onChange={(event) => setPiStartIso(event.target.value)} placeholder="2026-07-30" />
          </label>
          <label className={styles.field}>PI end (YYYY-MM-DD)
            <input className={styles.fieldInput} value={piEndIso} onChange={(event) => setPiEndIso(event.target.value)} placeholder="2026-10-07" />
          </label>
          <label className={styles.field}>Release project (fixVersions)
            <input className={styles.fieldInput} value={releaseProjectKey} onChange={(event) => setReleaseProjectKey(event.target.value)} placeholder="defaults to write project" />
          </label>
          <label className={styles.field}>Capacity / person / sprint
            <select className={styles.fieldInput} value={capacityPerSprint} onChange={(event) => setCapacityPerSprint(Number(event.target.value))}>
              <option value={8}>8 pts — conservative</option>
              <option value={10}>10 pts — standard</option>
              <option value={13}>13 pts — stretch</option>
            </select>
            <span className={styles.fieldHint}>80% load factor is applied to scheduling; the raw value caps Story size.</span>
          </label>
          <button className={`${styles.actionButton} ${styles.primaryButton}`} disabled={isBusy} onClick={() => void handleLoadFeatures()} type="button">
            {isBusy ? 'Loading…' : 'Load Features'}
          </button>
        </div>
        {loadSource && <p className={styles.statusLine}><strong>{loadSource}</strong></p>}
        {factSheet && (
          <>
            <p className={styles.statusLine}>{factSheet.features.length} Feature(s) · {factSheet.people.length} roster member(s) · {factSheet.repoAllowlist.length} repo(s) · delivery deadline {factSheet.deliveryDeadlineIso}</p>
            {factSheet.notes.length > 0 && <ul className={styles.notes}>{factSheet.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
            {defectFlags.length > 0 && (
              <div className={styles.warningBox}>
                <strong>⚠ Defect Features over budget</strong>
                <ul className={styles.notes}>
                  {defectFlags.map((flag) => (
                    <li key={flag.featureKey}>
                      {flag.featureKey} sized {flag.featureSize} pts, but child issues total {flag.childTotal} pts — over by {flag.overBy}. Re-point or split the bucket.
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Generate & ingest (AI-gated) ── */}
      {isAiUnlocked && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>2 · Generate the plan prompt &amp; paste the reply</h3>
          <>
            <button className={styles.actionButton} disabled={factSheet === null} onClick={handleGeneratePrompt} type="button">Generate delivery-plan prompt</button>
            {prompts.length > 0 && (
              <button className={styles.secondaryButton} onClick={() => void handleCopyPrompt()} type="button">
                {hasCopiedPrompt ? '✓ Copied' : '📋 Copy prompt'}
              </button>
            )}
            {prompts.length > 0 && <textarea className={styles.promptArea} readOnly value={prompts.join('\n\n=== NEXT CHUNK ===\n\n')} onFocus={(event) => event.currentTarget.select()} />}
            <label className={styles.field} style={{ marginTop: '0.5rem' }}>Paste the AI&apos;s JSON reply
              <textarea className={styles.replyArea} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder='{"kind":"piDeliveryPlan","stories":[ ... ]}' />
            </label>
            <button className={`${styles.actionButton} ${styles.primaryButton}`} disabled={factSheet === null || replyText.trim() === ''} onClick={handleIngest} type="button">Ingest & build plan</button>
          </>
        </section>
      )}

      {statusMessage && <p className={styles.statusLine}>{statusMessage}</p>}

      {/* ── Carryover: continue in-flight work (reconcile, never regenerate) ── */}
      {carryover.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>Carryover — continue in-flight Stories ({carryover.length})</h3>
          <p className={styles.statusLine}>These Stories already exist in Jira; only their <strong>missing</strong> sub-tasks are proposed — nothing is duplicated.</p>
          {carryover.map((item) => (
            <div key={item.reconcile.storyKey} className={styles.storyRow}>
              <div className={styles.storyHead}>
                <label className={styles.includeToggle}>
                  <input type="checkbox" checked={!excludedItemIds.has(carryoverItemId(item.reconcile.storyKey))} onChange={() => toggleItemIncluded(carryoverItemId(item.reconcile.storyKey))} />
                  <span className={styles.storyTitle}>{item.reconcile.storySummary}</span>
                </label>
                <span className={styles.statusLine}>{item.reconcile.storyKey} · {item.featureKey} · {item.reconcile.gapSubtasks.length} missing sub-task(s)</span>
              </div>
              <ul className={styles.subtaskList}>
                {item.reconcile.gapSubtasks.map((gap, index) => (
                  <li key={index} className={styles.subtaskItem}>
                    <span className={styles.repoTag}>{gap.kind === 'coding' ? gap.repo?.repoName : gap.kind}</span>
                    <span>{gap.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* ── Bottlenecks ── */}
      {bottlenecks.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>Bottlenecks (deterministic)</h3>
          {bottlenecks.map((bottleneck) => (
            <div key={bottleneck.id} className={styles.bottleneck}>
              <strong>{bottleneck.kind}</strong> — {bottleneck.statement}
              {bottleneck.mitigation && <div className={styles.bottleneckMitigation}>Mitigation: {bottleneck.mitigation}</div>}
            </div>
          ))}
        </section>
      )}

      {/* ── Plan review + per-item accept ── */}
      {plan && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>3 · Review the plan ({plan.stories.length} Stories) — nothing is written yet</h3>
          {plan.honestStates.length > 0 && <ul className={styles.notes}>{plan.honestStates.map((state, index) => <li key={index}>{state}</li>)}</ul>}
          <p className={styles.statusLine}>Untick anything you don&apos;t want, then use <strong>Commit all to Jira</strong> below. No Story or sub-task is created until you commit.</p>
          {plan.stories.map((story) => (
            <div key={story.tempId} className={styles.storyRow}>
              <div className={styles.storyHead}>
                <label className={styles.includeToggle}>
                  <input type="checkbox" checked={!excludedItemIds.has(story.tempId)} onChange={() => toggleItemIncluded(story.tempId)} />
                  <span className={styles.storyTitle}>{story.summary}</span>
                </label>
                <span className={styles.statusLine}>{story.featureKey} · {story.sprintName} · Target End {story.dates.targetEndIso} · Due {story.dates.dueIso ?? '—'} · fixVersion {story.fixVersionName ?? '—'}</span>
              </div>
              <ul className={styles.subtaskList}>
                {story.codingSubtasks.map((coding) => (
                  <li key={coding.repoName} className={styles.subtaskItem}>
                    <span className={styles.repoTag}>{coding.repoName}</span>
                    <span>{coding.devPoints} pts</span>
                    <select className={styles.assigneeSelect} value={assigneeOverrides[`${story.tempId}:${coding.repoName}`] ?? coding.assignee ?? ''} onChange={(event) => setAssigneeOverrides((previous) => ({ ...previous, [`${story.tempId}:${coding.repoName}`]: event.target.value }))}>
                      <option value="">(unassigned)</option>
                      {rosterDevNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </li>
                ))}
                <li className={styles.subtaskItem}><span className={styles.repoTag}>SL test</span><span>{story.slAssignee ?? '(unassigned)'}</span></li>
                <li className={styles.subtaskItem}>Deploys: INT {story.dates.deployIntIso} · REL {story.dates.deployRelIso} · PROD {story.dates.deployProdIso ?? '—'}</li>
              </ul>
              {story.warnings.map((warning, index) => <p key={index} className={styles.warning}>⚠ {warning}</p>)}
            </div>
          ))}
        </section>
      )}

      {/* ── Write settings ── */}
      {(plan || carryover.length > 0) && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>Write settings (required before commit)</h3>
          <div className={styles.controlRow}>
            {([
              ['projectKey', 'Project key'], ['storyIssueTypeId', 'Story issue-type id'], ['subTaskIssueTypeId', 'Sub-task issue-type id'],
              ['featureLink', 'Feature-link field id'], ['targetStart', 'Target Start field id'], ['targetEnd', 'Target End field id'],
            ] as [keyof typeof writeConfig, string][]).map(([key, label]) => (
              <label key={key} className={styles.field}>{label}
                <input className={styles.fieldInput} value={writeConfig[key]} onChange={(event) => setWriteConfig((previous) => ({ ...previous, [key]: event.target.value }))} />
                {fieldNameById[writeConfig[key]] && <span className={styles.statusLine}>{fieldNameById[writeConfig[key]]}</span>}
              </label>
            ))}
          </div>
        </section>
      )}

      {/* ── The single commit gate (Option B): the ONLY thing that writes to Jira ── */}
      {(plan || carryover.length > 0) && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>Commit to Jira</h3>
          <p className={styles.statusLine}>
            {commitItemCount} item(s) staged — {includedStories.length} new Story(ies) (with sub-tasks) + {includedCarryover.length} gap-fill(s) on existing Stories.
            Nothing has been written yet.
          </p>
          {!isWriteConfigured && <p className={styles.warning}>⚠ Complete Write settings above before committing.</p>}
          <button
            className={`${styles.actionButton} ${styles.primaryButton}`}
            disabled={isBusy || !isWriteConfigured || commitItemCount === 0}
            onClick={() => void handleCommitAll()}
            type="button"
          >
            {isBusy ? 'Committing…' : `Commit all to Jira (${commitItemCount} item${commitItemCount === 1 ? '' : 's'})`}
          </button>
          {commitResults && (
            <ul className={styles.notes}>
              {commitResults.map((result) => (
                <li key={result.id} className={result.status === 'success' ? styles.signalOnTrack : styles.signalOffTrack}>
                  {result.status === 'success' ? '✓' : '✗'} {result.label} — {result.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Defect sub-tasks (on demand — defects are unplanned) ── */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>Defect sub-tasks (on demand)</h3>
        <p className={styles.statusLine}>
          Defects are unplanned — stage their repo→sub-task scaffold when you build them. Enter a Defect key; its
          impacted <strong>repo components</strong> drive one coding sub-task each (+ SL + deploys). It is <strong>added
          to the commit set above</strong> (idempotent — only missing sub-tasks) and written when you Commit all.
        </p>
        <div className={styles.controlRow}>
          <label className={styles.field}>Defect key
            <input className={styles.fieldInput} value={defectKey} onChange={(event) => setDefectKey(event.target.value)} placeholder="DENP-1234" />
          </label>
          <button className={styles.actionButton} disabled={isBusy || !isWriteConfigured || defectKey.trim() === ''} onClick={() => void handleGenerateDefectSubtasks()} type="button">
            Add to plan
          </button>
        </div>
        {!isWriteConfigured && <p className={styles.statusLine}>Write settings not yet configured — they auto-fill; load Features once to review them.</p>}
      </section>

      {/* ── Monitor ── */}
      {plan && factSheet && (
        <PiDeliveryMonitor plan={plan} factSheet={factSheet} featureLinkFieldId={writeConfig.featureLink} />
      )}
    </div>
  );
}
