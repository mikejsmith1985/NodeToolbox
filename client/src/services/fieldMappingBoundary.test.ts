// fieldMappingBoundary.test.ts — The rule that stops the field ids spreading again.
//
// An inventory of this codebase found 55 hard-coded `customfield_*` ids across 82 files, story points
// alone declared under 14 constant names holding 4 different values — one of them not a field id at
// all. Three live defects came out of that in a single week: a check reading a field the instance does
// not use, a write landing where nothing reads, and two screens disagreeing about a shared workspace.
//
// None of them was a crash. Divergence type-checks, passes every test, and surfaces months later as a
// screen that looks right and is not. A document describing the tidied state is something the code
// drifts back out of; a failing test is something it cannot.
//
// So: the LOGICAL fields belong to `jiraFieldMapping.ts`. A module that resolves one for itself is the
// bug this test exists to prevent — it will always be resolvable, and it will sometimes be wrong.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Where the sweep starts. */
const CLIENT_SOURCE_ROOT = join(process.cwd(), 'src');

/**
 * Files allowed to name a story-points field id.
 *
 * Deliberately short, and each entry earns its place: the mapping DEFINES the ids, its own tests
 * assert them, the write helper resolves a field on Jira's edit screen, and the delegating shim
 * names one while its callers are migrated. Anything else appearing here is the regression.
 */
const STORY_POINTS_ALLOWED_FILES = [
  'services/jiraFieldMapping.ts',
  'services/jiraFieldMapping.test.ts',
  'services/fieldMappingBoundary.test.ts',
  'views/ReportsHub/storyPointsField.ts',
  'views/SprintDashboard/featureReviewFixes.ts',
];

/** The ids that carry story points on this instance, past and present. */
const STORY_POINTS_FIELD_IDS = ['customfield_10236', 'customfield_10028', 'customfield_10016'];

/** Every source file under a root, as paths relative to it. */
function listSourceFiles(directoryPath: string, relativePrefix = ''): string[] {
  return readdirSync(directoryPath).flatMap((entryName) => {
    const entryPath = join(directoryPath, entryName);
    const relativePath = relativePrefix === '' ? entryName : `${relativePrefix}/${entryName}`;
    if (statSync(entryPath).isDirectory()) {
      return listSourceFiles(entryPath, relativePath);
    }
    return /\.(ts|tsx)$/.test(entryName) ? [relativePath] : [];
  });
}

/**
 * Files that name a story-points id today and have not been migrated yet.
 *
 * A DEBT LIST, not an allow-list: it may only ever shrink. Sixty-three files carried one when this
 * rule was written, and demanding all of them at once would have produced a test somebody skipped
 * rather than a rule anybody kept. A ratchet stops the bleeding on the same day and lets the
 * migration proceed a file at a time.
 *
 * Remove an entry when its file stops naming an id. Never add one.
 */
const STORY_POINTS_UNMIGRATED_FILES = [
  'components/IssueDetailPanel/index.test.tsx',
  'components/IssueDetailPanel/index.tsx',
  'components/JiraFieldPicker/index.test.tsx',
  'services/issueLookup.test.ts',
  'services/issueLookup.ts',
  'services/jiraApi.test.ts',
  'types/jira.ts',
  'views/AdminHub/AdminHubView.tsx',
  'views/ArtView/ArtView.test.tsx',
  'views/ArtView/ArtView.tsx',
  'views/ArtView/blueprintHierarchy.ts',
  'views/ArtView/blueprintHierarchy.test.ts',
  'views/ArtView/carryoverEstimateFetch.test.ts',
  'views/ArtView/hooks/artHelpers.test.ts',
  'views/ArtView/hooks/artHelpers.ts',
  'views/ArtView/hooks/useArtData.test.ts',
  'views/ArtView/piReviewJira.test.ts',
  'views/ArtView/PiReviewTab.test.tsx',
  'views/DsuBoard/DsuBoardView.tsx',
  'views/DsuBoard/hooks/useDsuBoardState.test.ts',
  'views/DsuBoard/hooks/useDsuBoardState.ts',
  'views/FeatureCanvas/canvas/useCanvasFeatures.test.ts',
  'views/FeatureCanvas/planner/CapacityPlanPanel.reassign.test.tsx',
  'views/FeatureCanvas/planner/CapacityPlanPanel.test.tsx',
  'views/FeatureCanvas/planner/plannerFetch.test.ts',
  'views/FeatureCanvas/planner/plannerFetch.ts',
  'views/Hygiene/ai/hygieneAiApply.test.ts',
  'views/Hygiene/checks/hygieneChecks.test.ts',
  'views/Hygiene/checks/hygieneChecks.ts',
  'views/Hygiene/checks/storyPointsField.test.ts',
  'views/Hygiene/checks/storyPointsField.ts',
  'views/Hygiene/hooks/hygieneScan.test.ts',
  'views/Hygiene/hooks/hygieneScan.ts',
  'views/Hygiene/hooks/useHygieneState.test.ts',
  'views/MyIssues/myIssuesExtendedTypes.ts',
  'views/PipelineView/hooks/usePipelineState.test.ts',
  'views/PipelineView/hooks/usePipelineState.ts',
  'views/PipelineView/utils/rollup.test.ts',
  'views/PipelineView/utils/rollup.ts',
  'views/ReportsHub/agingBacklogFetch.test.ts',
  'views/ReportsHub/PersonalFlowTab.test.tsx',
  'views/ReportsHub/storyPointsField.test.ts',
  'views/SprintDashboard/featureReview.test.ts',
  'views/SprintDashboard/featureReview.ts',
  'views/SprintDashboard/featureReviewFixes.test.ts',
  'views/SprintDashboard/hooks/sprintDashboardIssueUtils.test.ts',
  'views/SprintDashboard/hooks/sprintDashboardIssueUtils.ts',
  'views/SprintDashboard/hooks/useDashboardConfig.ts',
  'views/SprintDashboard/hooks/useSprintData.ts',
  'views/SprintDashboard/hooks/useSprintStandupState.test.ts',
  'views/SprintDashboard/hooks/useSprintStandupState.ts',
  'views/SprintDashboard/rollupBoard/emptyFeatureScan.test.ts',
  'views/SprintDashboard/rollupBoard/featureRollup.test.ts',
  'views/SprintDashboard/rollupBoard/issueFlagWrite.test.ts',
  'views/SprintDashboard/rollupBoard/rollupBoardFetch.test.ts',
  'views/SprintDashboard/rollupBoard/teamFeatureOwnership.test.ts',
  'views/SprintDashboard/SprintDashboardView.tsx',
  'views/SprintDashboard/StandupTab.test.tsx',
  'views/SprintPlanning/hooks/useSprintPlanningState.test.ts',
  'views/SprintPlanning/hooks/useSprintPlanningState.ts',
  'views/StoryPointing/hooks/useStoryPointingState.test.ts',
  'views/StoryPointing/hooks/useStoryPointingState.ts',
];

function findFilesNamingStoryPoints(): string[] {
  return listSourceFiles(CLIENT_SOURCE_ROOT)
    .filter((relativePath) => !STORY_POINTS_ALLOWED_FILES.includes(relativePath))
    .filter((relativePath) => {
      const fileText = readFileSync(join(CLIENT_SOURCE_ROOT, relativePath), 'utf8');
      return STORY_POINTS_FIELD_IDS.some((fieldId) => fileText.includes(fieldId));
    });
}

describe('the story-points field id stays in one place', () => {
  it('is named by no file the debt list does not already know about', () => {
    // Named rather than counted: a bare number says the rule broke and not where.
    const newOffenders = findFilesNamingStoryPoints()
      .filter((relativePath) => !STORY_POINTS_UNMIGRATED_FILES.includes(relativePath));

    expect(newOffenders).toEqual([]);
  });

  it('has a debt list that only shrinks', () => {
    // The ratchet itself. A file that stops naming an id must be struck off, or the list slowly
    // becomes fiction and the rule it encodes stops meaning anything.
    const namingFiles = new Set(findFilesNamingStoryPoints());
    const settledEntries = STORY_POINTS_UNMIGRATED_FILES.filter((relativePath) => !namingFiles.has(relativePath));

    expect(settledEntries).toEqual([]);
  });

  it('keeps the allow-list honest — every entry still exists and still names one', () => {
    // An allow-list that outlives its reason is how a rule quietly stops applying.
    const staleEntries = STORY_POINTS_ALLOWED_FILES.filter((relativePath) => {
      try {
        const fileText = readFileSync(join(CLIENT_SOURCE_ROOT, relativePath), 'utf8');
        return !STORY_POINTS_FIELD_IDS.some((fieldId) => fileText.includes(fieldId));
      } catch {
        return true;
      }
    });

    expect(staleEntries).toEqual([]);
  });
});

/** Files allowed to name the Program Increment field id. */
const PI_ALLOWED_FILES = [
  'services/jiraFieldMapping.ts',
  'services/jiraFieldMapping.test.ts',
  'services/fieldMappingBoundary.test.ts',
];

/** The PI field id debt list. Only ever shrinks — see the story-points list above. */
const PI_UNMIGRATED_FILES = [
  'services/confluenceApi.test.ts',
  'services/piNameSuggestions.test.ts',
  'services/piNameSuggestions.ts',
  'types/jira.ts',
  'views/AdminHub/AdminHubView.test.tsx',
  'views/AdminHub/AdminHubView.tsx',
  'views/AdminHub/piReviewSchedulerImport.test.ts',
  'views/AdminHub/piReviewSchedulerImport.ts',
  'views/AdminHub/PiReviewSchedulerPanel.test.tsx',
  'views/AdminHub/PiReviewSchedulerPanel.tsx',
  'views/ArtView/ArtView.test.tsx',
  'views/ArtView/ArtView.tsx',
  'views/ArtView/blueprintHierarchy.test.ts',
  'views/ArtView/hooks/useArtData.test.ts',
  'views/ArtView/piPlan/piPlanFields.test.ts',
  'views/ArtView/piPlan/piPlanFields.ts',
  'views/ArtView/piPlan/piPlanJira.test.ts',
  'views/ArtView/piReviewPullFeatures.test.ts',
  'views/ArtView/PiReviewTab.test.tsx',
  'views/ArtView/readiness/readinessFeatureQuery.test.ts',
  'views/ArtView/readiness/readinessScan.test.ts',
  'views/DsuBoard/DsuBoardView.test.tsx',
  'views/DsuBoard/DsuBoardView.tsx',
  'views/DsuBoard/hooks/useDsuBoardState.test.ts',
  'views/DsuBoard/hooks/useDsuBoardState.ts',
  'views/DsuBoard/hooks/useDsuFilters.test.ts',
  'views/DsuBoard/hooks/useDsuFilters.ts',
  'views/FeatureCanvas/canvas/scopeQuery.test.ts',
  'views/FeatureCanvas/canvas/useCanvasScope.test.ts',
  'views/Hygiene/ai/hygieneAiApply.test.ts',
  'views/Hygiene/checks/dateComparatorParity.test.ts',
  'views/Hygiene/checks/hygieneChecks.test.ts',
  'views/Hygiene/checks/hygieneChecks.ts',
  'views/Hygiene/checks/hygieneFieldConfig.test.ts',
  'views/Hygiene/hooks/hygieneScan.test.ts',
  'views/Hygiene/hooks/useHygieneState.test.ts',
  'views/PoTool/ai/compositionFieldPrefill.test.ts',
  'views/PoTool/hooks/usePoHygieneContext.test.ts',
  'views/PoTool/jira/compositionReadiness.test.ts',
  'views/ReportsHub/hooks/useReportsHubState.test.ts',
  'views/ReportsHub/hooks/useReportsHubState.ts',
  'views/SprintDashboard/featureReview.test.ts',
  'views/SprintDashboard/FeatureReviewTab.test.tsx',
  'views/SprintDashboard/hooks/useSprintData.test.ts',
  'views/SprintDashboard/hooks/useSprintData.ts',
  'views/SprintDashboard/piFeatureRemap.test.ts',
  'views/SprintDashboard/productOwnerFeatureReview.test.ts',
  'views/SprintDashboard/RiskManagementSection.tsx',
  'views/SprintDashboard/rollupBoard/components/PlacementTroubleshooter.test.tsx',
  'views/SprintDashboard/rollupBoard/createWorkForFeature.test.ts',
  'views/SprintDashboard/rollupBoard/placementDiagnosis.test.ts',
  'views/SprintDashboard/scopedTeamFeatures.test.ts',
  'views/SprintDashboard/scopedTeamFeatures.ts',
];

/** Files allowed to name the ART settings storage key directly. */
const ART_SETTINGS_ALLOWED_FILES = [
  // Lists the key in a storage-cleanup array rather than parsing it — naming a key to CLEAR it is
  // not a second reader, and forcing it through the reader would be ceremony with no benefit.
  'views/ReportsHub/ReportsHubRuntimeBoundary.tsx',
  'services/artSettingsStore.ts',
  'services/artSettingsStore.test.ts',
  'services/jiraFieldMapping.ts',
  'services/fieldMappingBoundary.test.ts',
  'views/ArtView/sharedArtWorkspaceSettings.ts',
  // Reads a LEGACY `teams` array out of the settings blob — a migration path for data written before
  // teams moved to their own key. Not a field id and not a setting the shared reader exposes.
  'views/ReportsHub/hooks/useReportsHubState.ts',
  // The Admin Hub settings EDITOR: it reads the raw blob to populate its form and writes it back.
  // An editor is not a second reader of the values it edits.
  'views/AdminHub/hooks/useAdminHubState.ts',
  // Also a writer: the Train space persists the ART settings through this hook.
  'views/ArtView/hooks/useArtData.ts',
  // Still names the key because it WRITES the settings blob — the Advanced ART Settings panel lives
  // here. Writing is not a second reader, and routing a write through the reader would be ceremony.
  'views/ArtView/ArtView.tsx',
];

/** The direct-settings-read debt list. Only ever shrinks. */
const ART_SETTINGS_UNMIGRATED_FILES = [
  'services/jiraFieldMapping.test.ts',
  'utils/featureLink.test.ts',
  'views/AdminHub/FieldMappingPanel.test.tsx',
  'views/ArtView/ArtView.test.tsx',
  'views/ArtView/blueprintHierarchy.test.ts',
  'views/ArtView/DependenciesTab.test.tsx',
  'views/ArtView/hooks/useArtData.test.ts',
  'views/ArtView/piReviewJira.test.ts',
  'views/ArtView/PiReviewTab.test.tsx',
  'views/Hygiene/checks/hygieneFieldConfig.test.ts',
  'views/Hygiene/checks/storyPointsField.test.ts',
  'views/ReportsHub/hooks/useReportsHubState.test.ts',
  'views/ReportsHub/PersonalFlowTab.test.tsx',
  'views/ReportsHub/storyPointsField.test.ts',
  'views/SprintDashboard/featureReview.test.ts',
  'views/SprintDashboard/featureReviewFixes.ts',
  'views/SprintDashboard/rollupBoard/boardScopeStore.test.ts',
  'views/SprintDashboard/sprintDashboardArtContext.ts',
  'views/SprintDashboard/TeamDashboardHygieneTab.test.tsx',
  'views/SprintDashboard/teamHygieneScope.test.ts',
];

/** Every file naming `needle`, excluding the ones allowed to. */
function findFilesNaming(needle: string, allowedFiles: readonly string[]): string[] {
  return listSourceFiles(CLIENT_SOURCE_ROOT)
    .filter((relativePath) => !allowedFiles.includes(relativePath))
    .filter((relativePath) => readFileSync(join(CLIENT_SOURCE_ROOT, relativePath), 'utf8').includes(needle));
}

describe('the Program Increment field id stays in one place', () => {
  // 59 files name it today, all agreeing on customfield_10301 — an agreement nothing enforces. The
  // Jira re-instance turns ten copies into ten edits and one chance to miss.
  it('is named by no file the debt list does not already know about', () => {
    const newOffenders = findFilesNaming('customfield_10301', PI_ALLOWED_FILES)
      .filter((relativePath) => !PI_UNMIGRATED_FILES.includes(relativePath));

    expect(newOffenders).toEqual([]);
  });

  it('has a debt list that only shrinks', () => {
    const namingFiles = new Set(findFilesNaming('customfield_10301', PI_ALLOWED_FILES));
    expect(PI_UNMIGRATED_FILES.filter((relativePath) => !namingFiles.has(relativePath))).toEqual([]);
  });
});

describe('the ART settings are read through one module', () => {
  // Nineteen hand-rolled parses, each with its own idea of what absent meant, is how the Roll-Up
  // Board and the Train settings screen came to disagree about whether a workspace existed at all.
  it('is parsed by no file the debt list does not already know about', () => {
    const newOffenders = findFilesNaming("'tbxARTSettings'", ART_SETTINGS_ALLOWED_FILES)
      .filter((relativePath) => !ART_SETTINGS_UNMIGRATED_FILES.includes(relativePath));

    expect(newOffenders).toEqual([]);
  });

  it('has a debt list that only shrinks', () => {
    const namingFiles = new Set(findFilesNaming("'tbxARTSettings'", ART_SETTINGS_ALLOWED_FILES));
    expect(ART_SETTINGS_UNMIGRATED_FILES.filter((relativePath) => !namingFiles.has(relativePath))).toEqual([]);
  });
});

/**
 * Files allowed to name the Feature Link field id.
 *
 * `utils/featureLink.ts` earns its place: it is bundled into the SERVER engine, where there is no
 * localStorage and therefore no configured override to resolve. It keeps the id as the answer for
 * that environment only — the browser path delegates to the mapping like everything else.
 */
const FEATURE_LINK_ALLOWED_FILES = [
  'services/jiraFieldMapping.ts',
  'services/jiraFieldMapping.test.ts',
  'services/fieldMappingBoundary.test.ts',
  'utils/featureLink.ts',
];

/** The Feature Link debt list. Only ever shrinks. */
const FEATURE_LINK_UNMIGRATED_FILES = [
  'views/ArtView/blueprintHierarchy.ts',
  'types/jira.ts',
  'views/AdminHub/FieldMappingPanel.test.tsx',
  'views/AdminHub/MonthlyDeliveryPanel.test.tsx',
  'views/ArtView/blueprintHierarchy.test.ts',
  'views/ArtView/BlueprintTab.test.tsx',
  'views/ArtView/carryoverEstimateFetch.test.ts',
  'views/ArtView/DependenciesTab.test.tsx',
  'views/ArtView/piPlan/piPlanFields.test.ts',
  'views/ArtView/piPlan/piPlanFields.ts',
  'views/ArtView/piPlan/piPlanJira.test.ts',
  'views/ArtView/piReviewDeliveryDates.test.ts',
  'views/ArtView/piReviewDeliveryDates.ts',
  'views/ArtView/piReviewJira.test.ts',
  'views/ArtView/PiReviewTab.test.tsx',
  'views/Hygiene/checks/hygieneChecks.test.ts',
  'views/Hygiene/checks/hygieneChecks.ts',
  'views/Hygiene/checks/hygieneFieldConfig.test.ts',
  'views/Hygiene/featureLinkInheritFix.test.ts',
  'views/Hygiene/hooks/hygieneScan.test.ts',
  'views/Hygiene/hooks/useHygieneState.test.ts',
  'views/PoTool/jira/compositionReadiness.test.ts',
  'views/SprintDashboard/featureReview.test.ts',
  'views/SprintDashboard/FeatureReviewTab.test.tsx',
  'views/SprintDashboard/piFeatureRemap.test.ts',
  'views/SprintDashboard/rollupBoard/cloneFamily.test.ts',
  'views/SprintDashboard/rollupBoard/components/ChildCard.test.tsx',
  'views/SprintDashboard/rollupBoard/components/PlacementTroubleshooter.test.tsx',
  'views/SprintDashboard/rollupBoard/createWorkForFeature.test.ts',
  'views/SprintDashboard/rollupBoard/defectRollup.test.ts',
  'views/SprintDashboard/rollupBoard/disciplineDiscovery.test.ts',
  'views/SprintDashboard/rollupBoard/featureRollup.test.ts',
  'views/SprintDashboard/rollupBoard/featureScope.test.ts',
  'views/SprintDashboard/rollupBoard/placementDiagnosis.test.ts',
  'views/SprintDashboard/rollupBoard/rollupBoardFetch.test.ts',
  'views/SprintDashboard/rollupBoard/RollupBoardTab.test.tsx',
  'views/SprintDashboard/rollupBoard/teamFeatureOwnership.test.ts',
];

describe('the Feature Link field id stays in one place', () => {
  // It decides which Feature every Story, sub-task and defect rolls up to — so every swimlane, every
  // progress figure and the whole Roll-Up Board. 40 files name it under four different constant
  // names, agreeing by coincidence.
  it('is named by no file the debt list does not already know about', () => {
    const newOffenders = findFilesNaming('customfield_10108', FEATURE_LINK_ALLOWED_FILES)
      .filter((relativePath) => !FEATURE_LINK_UNMIGRATED_FILES.includes(relativePath));

    expect(newOffenders).toEqual([]);
  });

  it('has a debt list that only shrinks', () => {
    const namingFiles = new Set(findFilesNaming('customfield_10108', FEATURE_LINK_ALLOWED_FILES));
    expect(FEATURE_LINK_UNMIGRATED_FILES.filter((relativePath) => !namingFiles.has(relativePath))).toEqual([]);
  });
});
