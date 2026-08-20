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
  'views/ArtView/blueprintHierarchy.test.ts',
  'views/ArtView/blueprintHierarchy.ts',
  'views/ArtView/carryoverEstimateFetch.test.ts',
  'views/ArtView/hooks/artHelpers.test.ts',
  'views/ArtView/hooks/artHelpers.ts',
  'views/ArtView/hooks/useArtData.test.ts',
  'views/ArtView/hooks/useArtData.ts',
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
