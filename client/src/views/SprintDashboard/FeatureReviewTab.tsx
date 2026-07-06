// FeatureReviewTab.tsx — Team Dashboard view that rolls up Blueprint-discovered features and lets teams fix hygiene flags in place.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { loadDashboardConfigFromStorage } from './hooks/useDashboardConfig.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';

import { useToast } from '../../components/Toast/ToastContext.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import type { JiraTransition } from '../../types/jira.ts';
import type { BlueprintHealthStatus, BlueprintStoryNode } from '../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import type { HygieneCheckId, HygieneFieldConfig, HygieneFlag } from '../Hygiene/checks/hygieneChecks.ts';
import {
  fetchFeatureReviewEditMeta,
  fetchFeatureReviewFixVersions,
  fetchFeatureReviewTransitions,
  readFeatureReviewFieldValue,
  readFeatureReviewSelectOptions,
  readProjectKeyFromIssueKey,
  saveFeatureReviewFixVersion,
  saveFeatureReviewIssueLinkField,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewTransition,
  saveFeatureReviewStoryPoints,
  saveFeatureReviewUserField,
  searchFeatureReviewUsers,
  type FeatureReviewEditMetaField,
  type FeatureReviewSelectOption,
  type FeatureReviewUserCandidate,
} from './featureReviewFixes.ts';
import {
  fetchFeatureReviewFieldConfig,
  fetchFeatureReviewItems,
  type FeatureReviewItem,
} from './featureReview.ts';
import {
  findMatchingArtTeam,
  readFallbackSelectedPiName,
  readStoredArtTeams,
} from './sprintDashboardArtContext.ts';
import styles from './SprintDashboardView.module.css';

const ART_VIEW_ROUTE = '/art';
const EMPTY_CONTEXT_LABEL = 'Not selected';
const FEATURE_REVIEW_INTRO =
  'Review the team’s current PI feature rollup with shared hygiene signals so carryover and cleanup decisions stay in one workspace.';
const FEATURE_REVIEW_STORY_LIMIT = 5;
const JIRA_BROWSE_URL_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
const HEALTH_LABELS: Record<BlueprintHealthStatus, string> = {
  green: 'On track',
  yellow: 'Watch',
  red: 'Blocked',
  blue: 'Getting started',
  gray: 'No stories yet',
};

interface FeatureReviewTabProps {
  boardId: number | null;
  boardName: string | null;
  projectKey: string;
  selectedPiName: string;
}

interface FeatureReviewQuickFixPanelProps {
  featureReviewFieldConfig: HygieneFieldConfig;
  featureReviewItem: FeatureReviewItem;
  onFeatureFixed: () => Promise<void>;
  showToast: (message: string, tone: 'success' | 'error') => void;
}

const STATUS_TRANSITION_FIELD_KEY = 'statusTransition';

function readBoardLabel(boardName: string | null, boardId: number | null): string {
  if (boardName && boardName.trim() !== '') {
    return boardName.trim();
  }

  return boardId === null ? EMPTY_CONTEXT_LABEL : String(boardId);
}

function readHealthToneClassName(healthStatus: BlueprintHealthStatus): string {
  if (healthStatus === 'green') {
    return styles.healthOnTrack;
  }

  if (healthStatus === 'yellow') {
    return styles.healthWatch;
  }

  if (healthStatus === 'red') {
    return styles.healthAtRisk;
  }

  return styles.featureReviewHealthBadge;
}

function readHygieneToneClassName(hygieneFlag: HygieneFlag): string {
  return hygieneFlag.severity === 'error' ? styles.featureReviewFlagError : styles.featureReviewFlagWarn;
}

function readFeatureJiraBrowseUrl(issueKey: string): string {
  return `${JIRA_BROWSE_URL_PREFIX}${issueKey}`;
}

function hasHygieneFlag(hygieneFlags: readonly HygieneFlag[], checkId: HygieneCheckId): boolean {
  return hygieneFlags.some((hygieneFlag) => hygieneFlag.checkId === checkId);
}

function readPrimaryFieldId(fieldIds: readonly string[]): string {
  return fieldIds[0] ?? '';
}

function readIssueTextValue(issue: FeatureReviewItem['featureIssue'], fieldIds: readonly string[]): string {
  for (const fieldId of fieldIds) {
    const rawFieldValue = (issue.fields as Record<string, unknown>)[fieldId];
    if (typeof rawFieldValue === 'string' && rawFieldValue.trim() !== '') {
      return rawFieldValue;
    }

    if (rawFieldValue && typeof rawFieldValue === 'object') {
      const normalizedFieldText = normalizeRichTextToPlainText(rawFieldValue);
      if (normalizedFieldText.trim() !== '') {
        return normalizedFieldText;
      }
    }
  }

  return '';
}

function readStoryPointsDrafts(featureReviewItem: FeatureReviewItem): Record<string, string> {
  return [...featureReviewItem.feature.children, ...featureReviewItem.feature.offTrain].reduce<Record<string, string>>(
    (storyPointLookup, storyNode) => ({
      ...storyPointLookup,
      [storyNode.key]: storyNode.storyPoints === null || storyNode.storyPoints === undefined ? '' : String(storyNode.storyPoints),
    }),
    {},
  );
}

function readFixFieldDrafts(
  featureReviewItem: FeatureReviewItem,
  featureReviewFieldConfig: HygieneFieldConfig,
): Record<string, string> {
  const featureIssue = featureReviewItem.featureIssue;
  return {
    acceptanceCriteria: readIssueTextValue(featureIssue, featureReviewFieldConfig.acceptanceCriteriaFieldIds),
    application: readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.applicationFieldIds)),
    assignee: featureIssue.fields.assignee?.displayName ?? '',
    dueDate: featureIssue.fields.duedate ?? '',
    fixVersion: featureIssue.fields.fixVersions?.[0]?.name ?? '',
    initiativeType: readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.initiativeTypeFieldIds)),
    parentLink: featureIssue.fields.parent?.key ?? readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.parentLinkFieldIds)),
    productOwner: readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.productOwnerFieldIds)),
    programIncrement: readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.programIncrementFieldIds)),
    summary: featureIssue.fields.summary ?? '',
    targetEnd: readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.targetEndFieldIds)),
    targetStart: readFeatureReviewFieldValue(featureIssue, readPrimaryFieldId(featureReviewFieldConfig.targetStartFieldIds)),
  };
}

function readQuickFixPanelResetKey(
  featureReviewItem: FeatureReviewItem,
  featureReviewFieldConfig: HygieneFieldConfig,
): string {
  return JSON.stringify({
    fieldDraftByKey: readFixFieldDrafts(featureReviewItem, featureReviewFieldConfig),
    storyPointsDraftByIssueKey: readStoryPointsDrafts(featureReviewItem),
    hygieneFlagIds: featureReviewItem.hygieneFlags.map((hygieneFlag) => hygieneFlag.checkId),
    statusName: featureReviewItem.featureIssue.fields.status?.name ?? '',
  });
}

function readSelectableFieldOptions(
  fieldKey: string,
  editMetaFields: Record<string, FeatureReviewEditMetaField | undefined>,
  featureReviewFieldConfig: HygieneFieldConfig,
): FeatureReviewSelectOption[] {
  if (fieldKey === 'fixVersion') {
    return [];
  }

  const fieldIdLookup: Record<string, string> = {
    application: readPrimaryFieldId(featureReviewFieldConfig.applicationFieldIds),
    initiativeType: readPrimaryFieldId(featureReviewFieldConfig.initiativeTypeFieldIds),
    productOwner: readPrimaryFieldId(featureReviewFieldConfig.productOwnerFieldIds),
    programIncrement: readPrimaryFieldId(featureReviewFieldConfig.programIncrementFieldIds),
  };
  const fieldId = fieldIdLookup[fieldKey] ?? '';
  return readFeatureReviewSelectOptions(editMetaFields[fieldId]);
}

function readMissingStoryPointChildren(featureReviewItem: FeatureReviewItem): BlueprintStoryNode[] {
  return [...featureReviewItem.feature.children, ...featureReviewItem.feature.offTrain].filter((storyNode) =>
    (storyNode.issueType === 'Story' || storyNode.issueType === 'Task') && (storyNode.storyPoints ?? 0) <= 0,
  );
}

function renderSaveStateMessage(saveMessage: string | null, isErrorMessage: boolean) {
  if (!saveMessage) {
    return null;
  }

  return (
    <span className={isErrorMessage ? styles.errorMessage : styles.featureReviewSuccessMessage}>
      {saveMessage}
    </span>
  );
}

interface PendingFixAction {
  fieldKey: string;
  run: () => Promise<void>;
}

function FeatureReviewQuickFixPanel({
  featureReviewFieldConfig,
  featureReviewItem,
  onFeatureFixed,
  showToast,
}: FeatureReviewQuickFixPanelProps) {
  const [isFixPanelOpen, setIsFixPanelOpen] = useState(false);
  const [isLoadingEditMeta, setIsLoadingEditMeta] = useState(false);
  // A single in-flight flag for the one "Save all fixes" button — there are no
  // longer per-field save buttons, so the whole batch shares one saving state.
  const [isSavingAllFixes, setIsSavingAllFixes] = useState(false);
  const [saveMessageByFieldKey, setSaveMessageByFieldKey] = useState<Record<string, string | null>>({});
  const [isErrorMessageByFieldKey, setIsErrorMessageByFieldKey] = useState<Record<string, boolean>>({});
  const [fieldDraftByKey, setFieldDraftByKey] = useState<Record<string, string>>(
    readFixFieldDrafts(featureReviewItem, featureReviewFieldConfig),
  );
  const [storyPointsDraftByIssueKey, setStoryPointsDraftByIssueKey] = useState<Record<string, string>>(
    readStoryPointsDrafts(featureReviewItem),
  );
  const [editMetaFields, setEditMetaFields] = useState<Record<string, FeatureReviewEditMetaField | undefined>>({});
  const [userSearchQueryByFieldKey, setUserSearchQueryByFieldKey] = useState<Record<string, string>>({});
  const [userCandidatesByFieldKey, setUserCandidatesByFieldKey] = useState<Record<string, FeatureReviewUserCandidate[]>>({});
  const [fixVersionOptions, setFixVersionOptions] = useState<FeatureReviewSelectOption[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<JiraTransition[]>([]);
  const [selectedTransitionId, setSelectedTransitionId] = useState('');
  const missingStoryPointChildren = useMemo(() => readMissingStoryPointChildren(featureReviewItem), [featureReviewItem]);

  const featureIssue = featureReviewItem.featureIssue;

  async function ensureEditMetaLoaded() {
    if (Object.keys(editMetaFields).length > 0) {
      return;
    }

    setIsLoadingEditMeta(true);
    try {
      const [loadedEditMetaFields, loadedFixVersionOptions, loadedTransitions] = await Promise.all([
        fetchFeatureReviewEditMeta(featureIssue.key),
        fetchFeatureReviewFixVersions(readProjectKeyFromIssueKey(featureIssue.key)),
        fetchFeatureReviewTransitions(featureIssue.key),
      ]);
      setEditMetaFields(loadedEditMetaFields);
      setFixVersionOptions(loadedFixVersionOptions);
      setAvailableTransitions(loadedTransitions);
    } finally {
      setIsLoadingEditMeta(false);
    }
  }

  // Records the per-field outcome message shown beside each fix row after a batch save.
  function recordFieldOutcome(fieldKey: string, message: string | null, isError: boolean) {
    setSaveMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: message }));
    setIsErrorMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: isError }));
  }

  async function handleSearchUsers(fieldKey: string) {
    const queryText = userSearchQueryByFieldKey[fieldKey]?.trim() ?? '';
    if (!queryText) {
      return;
    }

    try {
      const userCandidates = await searchFeatureReviewUsers(queryText);
      setUserCandidatesByFieldKey((currentCandidates) => ({ ...currentCandidates, [fieldKey]: userCandidates }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to search Jira users.';
      setSaveMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: errorMessage }));
      setIsErrorMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: true }));
      showToast(errorMessage, 'error');
    }
  }

  function renderTextFixRow(
    label: string,
    fieldKey: string,
    placeholder: string,
    isMultiline = false,
  ) {
    const inputValue = fieldDraftByKey[fieldKey] ?? '';
    const saveMessage = saveMessageByFieldKey[fieldKey] ?? null;
    const isErrorMessage = isErrorMessageByFieldKey[fieldKey] ?? false;

    return (
      <div className={styles.featureReviewFixRow} key={fieldKey}>
        <label className={styles.featureReviewFixLabel}>
          <span>{label}</span>
          {isMultiline ? (
            <textarea
              className={styles.featureReviewFixTextArea}
              onChange={(event) => setFieldDraftByKey((currentDrafts) => ({ ...currentDrafts, [fieldKey]: event.target.value }))}
              value={inputValue}
            />
          ) : (
            <input
              className={styles.settingsInput}
              onChange={(event) => setFieldDraftByKey((currentDrafts) => ({ ...currentDrafts, [fieldKey]: event.target.value }))}
              placeholder={placeholder}
              type="text"
              value={inputValue}
            />
          )}
        </label>
        {saveMessage ? (
          <div className={styles.featureReviewFixActionRow}>{renderSaveStateMessage(saveMessage, isErrorMessage)}</div>
        ) : null}
      </div>
    );
  }

  function renderDateFixRow(label: string, fieldKey: string) {
    const inputValue = fieldDraftByKey[fieldKey] ?? '';
    const saveMessage = saveMessageByFieldKey[fieldKey] ?? null;
    const isErrorMessage = isErrorMessageByFieldKey[fieldKey] ?? false;

    return (
      <div className={styles.featureReviewFixRow} key={fieldKey}>
        <label className={styles.featureReviewFixLabel}>
          <span>{label}</span>
          <input
            className={styles.settingsInput}
            onChange={(event) => setFieldDraftByKey((currentDrafts) => ({ ...currentDrafts, [fieldKey]: event.target.value }))}
            type="date"
            value={inputValue}
          />
        </label>
        {saveMessage ? (
          <div className={styles.featureReviewFixActionRow}>{renderSaveStateMessage(saveMessage, isErrorMessage)}</div>
        ) : null}
      </div>
    );
  }

  function renderSelectFixRow(label: string, fieldKey: string) {
    const selectOptions = fieldKey === 'fixVersion'
      ? fixVersionOptions
      : readSelectableFieldOptions(fieldKey, editMetaFields, featureReviewFieldConfig);
    const inputValue = fieldDraftByKey[fieldKey] ?? '';
    const saveMessage = saveMessageByFieldKey[fieldKey] ?? null;
    const isErrorMessage = isErrorMessageByFieldKey[fieldKey] ?? false;

    return (
      <div className={styles.featureReviewFixRow} key={fieldKey}>
        <label className={styles.featureReviewFixLabel}>
          <span>{label}</span>
          <select
            className={styles.settingsInput}
            onChange={(event) => setFieldDraftByKey((currentDrafts) => ({ ...currentDrafts, [fieldKey]: event.target.value }))}
            value={inputValue}
          >
            <option value="">Select…</option>
            {selectOptions.map((selectOption) => (
              <option key={`${fieldKey}-${selectOption.value}`} value={selectOption.value}>{selectOption.label}</option>
            ))}
          </select>
        </label>
        {saveMessage ? (
          <div className={styles.featureReviewFixActionRow}>{renderSaveStateMessage(saveMessage, isErrorMessage)}</div>
        ) : null}
      </div>
    );
  }

  function renderUserFixRow(label: string, fieldKey: string) {
    const searchValue = userSearchQueryByFieldKey[fieldKey] ?? '';
    const selectedUserIdentifier = fieldDraftByKey[fieldKey] ?? '';
    const saveMessage = saveMessageByFieldKey[fieldKey] ?? null;
    const isErrorMessage = isErrorMessageByFieldKey[fieldKey] ?? false;
    const userCandidates = userCandidatesByFieldKey[fieldKey] ?? [];

    return (
      <div className={styles.featureReviewFixRow} key={fieldKey}>
        <label className={styles.featureReviewFixLabel}>
          <span>{label}</span>
          <div className={styles.featureReviewFixInlineRow}>
            <input
              className={styles.settingsInput}
              onChange={(event) => setUserSearchQueryByFieldKey((currentQueries) => ({ ...currentQueries, [fieldKey]: event.target.value }))}
              placeholder="Search Jira users"
              type="text"
              value={searchValue}
            />
            <button className={styles.secondaryButton} onClick={() => void handleSearchUsers(fieldKey)} type="button">
              Search
            </button>
          </div>
        </label>
        {userCandidates.length > 0 ? (
          <label className={styles.featureReviewFixLabel}>
            <span>Select user</span>
            <select
              className={styles.settingsInput}
              onChange={(event) => setFieldDraftByKey((currentDrafts) => ({ ...currentDrafts, [fieldKey]: event.target.value }))}
              value={selectedUserIdentifier}
            >
              <option value="">Select…</option>
              {userCandidates.map((userCandidate) => (
                <option key={userCandidate.userIdentifier} value={userCandidate.userIdentifier}>{userCandidate.displayName}</option>
              ))}
            </select>
          </label>
        ) : null}
        {saveMessage ? (
          <div className={styles.featureReviewFixActionRow}>{renderSaveStateMessage(saveMessage, isErrorMessage)}</div>
        ) : null}
      </div>
    );
  }

  function renderStoryPointFixRows() {
    if (!hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-child-story-points') || missingStoryPointChildren.length === 0) {
      return null;
    }

    return (
      <div className={styles.featureReviewChildFixSection}>
        <strong className={styles.featureReviewChildFixTitle}>Point child stories</strong>
        {missingStoryPointChildren.map((storyNode) => {
          const saveKey = `story-points-${storyNode.key}`;
          const saveMessage = saveMessageByFieldKey[saveKey] ?? null;
          const isErrorMessage = isErrorMessageByFieldKey[saveKey] ?? false;
          const draftValue = storyPointsDraftByIssueKey[storyNode.key] ?? '';
          return (
            <div className={styles.featureReviewStoryFixRow} key={storyNode.key}>
              <div className={styles.featureReviewStoryFixSummary}>
                <a className={styles.featureReviewStoryKey} href={readFeatureJiraBrowseUrl(storyNode.key)} rel="noreferrer" target="_blank">
                  {storyNode.key}
                </a>
                <span className={styles.featureReviewStorySummary}>{storyNode.summary}</span>
              </div>
              <div className={styles.featureReviewFixInlineRow}>
                <input
                  className={styles.settingsInput}
                  onChange={(event) => setStoryPointsDraftByIssueKey((currentDrafts) => ({ ...currentDrafts, [storyNode.key]: event.target.value }))}
                  placeholder="Story points"
                  type="number"
                  value={draftValue}
                />
              </div>
              {renderSaveStateMessage(saveMessage, isErrorMessage)}
            </div>
          );
        })}
      </div>
    );
  }

  function renderStatusTransitionRow() {
    const saveMessage = saveMessageByFieldKey[STATUS_TRANSITION_FIELD_KEY] ?? null;
    const isErrorMessage = isErrorMessageByFieldKey[STATUS_TRANSITION_FIELD_KEY] ?? false;

    return (
      <div className={styles.featureReviewFixRow} key={STATUS_TRANSITION_FIELD_KEY}>
        <label className={styles.featureReviewFixLabel}>
          <span>Change Status</span>
          <select
            aria-label="Change Status"
            className={styles.settingsInput}
            disabled={isLoadingEditMeta || isSavingAllFixes || availableTransitions.length === 0}
            onChange={(event) => setSelectedTransitionId(event.target.value)}
            value={selectedTransitionId}
          >
            <option value="">{isLoadingEditMeta ? 'Loading transitions…' : 'Select transition…'}</option>
            {availableTransitions.map((jiraTransition) => (
              <option key={jiraTransition.id} value={jiraTransition.id}>
                {jiraTransition.name}
              </option>
            ))}
          </select>
        </label>
        {saveMessage ? (
          <div className={styles.featureReviewFixActionRow}>{renderSaveStateMessage(saveMessage, isErrorMessage)}</div>
        ) : null}
      </div>
    );
  }

  const parentLinkFieldId = readPrimaryFieldId(featureReviewFieldConfig.parentLinkFieldIds);
  const programIncrementFieldId = readPrimaryFieldId(featureReviewFieldConfig.programIncrementFieldIds);
  const targetStartFieldId = readPrimaryFieldId(featureReviewFieldConfig.targetStartFieldIds);
  const targetEndFieldId = readPrimaryFieldId(featureReviewFieldConfig.targetEndFieldIds);
  const applicationFieldId = readPrimaryFieldId(featureReviewFieldConfig.applicationFieldIds);
  const initiativeTypeFieldId = readPrimaryFieldId(featureReviewFieldConfig.initiativeTypeFieldIds);
  const productOwnerFieldId = readPrimaryFieldId(featureReviewFieldConfig.productOwnerFieldIds);
  const acceptanceCriteriaFieldId = readPrimaryFieldId(featureReviewFieldConfig.acceptanceCriteriaFieldIds);
  const productOwnerEditMetaField = editMetaFields[productOwnerFieldId];
  const shouldUseProductOwnerUserSearch = productOwnerEditMetaField?.schema?.type === 'user';

  // Collects one save action per fix the user has actually filled in. This is the single
  // source of truth for the "Save all fixes" button — only rows whose draft has a value
  // (and whose hygiene flag is present) are saved, so untouched fields are left alone.
  function buildPendingFixActions(): PendingFixAction[] {
    const hygieneFlags = featureReviewItem.hygieneFlags;
    const pendingFixActions: PendingFixAction[] = [];

    function addAction(shouldInclude: boolean, draftValue: string, fieldKey: string, run: () => Promise<void>) {
      if (shouldInclude && draftValue.trim() !== '') {
        pendingFixActions.push({ fieldKey, run });
      }
    }

    addAction(hasHygieneFlag(hygieneFlags, 'missing-summary'), fieldDraftByKey.summary ?? '', 'summary',
      async () => saveFeatureReviewSimpleField(featureIssue.key, 'summary', fieldDraftByKey.summary ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-parent-link') && parentLinkFieldId !== '', fieldDraftByKey.parentLink ?? '', 'parentLink',
      async () => saveFeatureReviewIssueLinkField(featureIssue.key, parentLinkFieldId, fieldDraftByKey.parentLink ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-pi') && programIncrementFieldId !== '', fieldDraftByKey.programIncrement ?? '', 'programIncrement',
      async () => saveFeatureReviewOptionField(featureIssue.key, programIncrementFieldId, fieldDraftByKey.programIncrement ?? '', editMetaFields[programIncrementFieldId]));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-target-start') && targetStartFieldId !== '', fieldDraftByKey.targetStart ?? '', 'targetStart',
      async () => saveFeatureReviewSimpleField(featureIssue.key, targetStartFieldId, fieldDraftByKey.targetStart ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-target-end') && targetEndFieldId !== '', fieldDraftByKey.targetEnd ?? '', 'targetEnd',
      async () => saveFeatureReviewSimpleField(featureIssue.key, targetEndFieldId, fieldDraftByKey.targetEnd ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-application') && applicationFieldId !== '', fieldDraftByKey.application ?? '', 'application',
      async () => saveFeatureReviewOptionField(featureIssue.key, applicationFieldId, fieldDraftByKey.application ?? '', editMetaFields[applicationFieldId]));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-initiative-type') && initiativeTypeFieldId !== '', fieldDraftByKey.initiativeType ?? '', 'initiativeType',
      async () => saveFeatureReviewOptionField(featureIssue.key, initiativeTypeFieldId, fieldDraftByKey.initiativeType ?? '', editMetaFields[initiativeTypeFieldId]));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-product-owner') && productOwnerFieldId !== '', fieldDraftByKey.productOwner ?? '', 'productOwner',
      shouldUseProductOwnerUserSearch
        ? async () => saveFeatureReviewUserField(featureIssue.key, productOwnerFieldId, fieldDraftByKey.productOwner ?? '')
        : async () => saveFeatureReviewOptionField(featureIssue.key, productOwnerFieldId, fieldDraftByKey.productOwner ?? '', editMetaFields[productOwnerFieldId]));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-fix-version'), fieldDraftByKey.fixVersion ?? '', 'fixVersion',
      async () => saveFeatureReviewFixVersion(featureIssue.key, fieldDraftByKey.fixVersion ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'missing-due-date'), fieldDraftByKey.dueDate ?? '', 'dueDate',
      async () => saveFeatureReviewSimpleField(featureIssue.key, 'duedate', fieldDraftByKey.dueDate ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'no-ac') && acceptanceCriteriaFieldId !== '', fieldDraftByKey.acceptanceCriteria ?? '', 'acceptanceCriteria',
      async () => saveFeatureReviewSimpleField(featureIssue.key, acceptanceCriteriaFieldId, fieldDraftByKey.acceptanceCriteria ?? ''));
    addAction(hasHygieneFlag(hygieneFlags, 'no-assignee'), fieldDraftByKey.assignee ?? '', 'assignee',
      async () => saveFeatureReviewUserField(featureIssue.key, 'assignee', fieldDraftByKey.assignee ?? ''));

    if (hasHygieneFlag(hygieneFlags, 'missing-child-story-points')) {
      for (const storyNode of missingStoryPointChildren) {
        const draftValue = storyPointsDraftByIssueKey[storyNode.key] ?? '';
        addAction(true, draftValue, `story-points-${storyNode.key}`,
          async () => saveFeatureReviewStoryPoints(storyNode.key, draftValue));
      }
    }

    // Status transition clears its own selection on success so a retry of a partly-failed
    // batch does not re-apply a transition that is no longer valid from the new status.
    addAction(true, selectedTransitionId, STATUS_TRANSITION_FIELD_KEY, async () => {
      await saveFeatureReviewTransition(featureIssue.key, selectedTransitionId);
      setSelectedTransitionId('');
    });

    return pendingFixActions;
  }

  // Saves every filled-in fix in one pass, then refreshes the feature data ONCE — only when
  // the whole batch succeeded. A partial failure keeps the panel open with the failed
  // drafts intact and per-field error messages so the user can retry just those.
  async function handleSaveAllFixes() {
    const pendingFixActions = buildPendingFixActions();
    if (pendingFixActions.length === 0) {
      showToast('Enter at least one fix before saving.', 'error');
      return;
    }

    setIsSavingAllFixes(true);
    let savedFixCount = 0;
    const failedFieldKeys: string[] = [];
    for (const pendingFixAction of pendingFixActions) {
      recordFieldOutcome(pendingFixAction.fieldKey, null, false);
      try {
        await pendingFixAction.run();
        recordFieldOutcome(pendingFixAction.fieldKey, 'Saved.', false);
        savedFixCount += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `Unable to save ${pendingFixAction.fieldKey}.`;
        recordFieldOutcome(pendingFixAction.fieldKey, errorMessage, true);
        failedFieldKeys.push(pendingFixAction.fieldKey);
      }
    }
    setIsSavingAllFixes(false);

    if (savedFixCount > 0) {
      showToast(`${featureIssue.key} — ${savedFixCount} fix${savedFixCount === 1 ? '' : 'es'} saved.`, 'success');
    }
    if (failedFieldKeys.length > 0) {
      showToast(`${featureIssue.key} — ${failedFieldKeys.length} fix${failedFieldKeys.length === 1 ? '' : 'es'} could not be saved.`, 'error');
    }

    // Single refresh at the very end, only when nothing failed — this is what stops the
    // "refreshes after every save" thrash the user was hitting.
    if (savedFixCount > 0 && failedFieldKeys.length === 0) {
      await onFeatureFixed();
    }
  }

  const pendingFixCount = buildPendingFixActions().length;

  return (
    <section className={styles.featureReviewFixPanel}>
      <div className={styles.featureReviewFixHeader}>
        <div className={styles.featureReviewFixHeaderLabel}>
          <strong>Direct hygiene fixes</strong>
          <span className={styles.featureReviewFixFeatureContext}>
            → {featureIssue.key}
          </span>
        </div>
        <button
          className={styles.secondaryButton}
          onClick={() => {
            if (!isFixPanelOpen) {
              void ensureEditMetaLoaded();
            }
            setIsFixPanelOpen((isCurrentOpen) => !isCurrentOpen);
          }}
          type="button"
        >
          {isFixPanelOpen ? 'Hide Fixes' : 'Show Fixes'}
        </button>
      </div>
      {isFixPanelOpen ? (
        <div className={styles.featureReviewFixGrid}>
          {isLoadingEditMeta ? <p className={styles.spinnerText}>Loading Jira edit options…</p> : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-summary')
            ? renderTextFixRow('Feature name / summary', 'summary', 'Enter feature summary')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-parent-link') && parentLinkFieldId
            ? renderTextFixRow('Parent link', 'parentLink', 'Enter parent issue key')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-pi') && programIncrementFieldId
            ? renderSelectFixRow('Program Increment', 'programIncrement')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-target-start') && targetStartFieldId
            ? renderDateFixRow('Target Start', 'targetStart')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-target-end') && targetEndFieldId
            ? renderDateFixRow('Target End', 'targetEnd')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-application') && applicationFieldId
            ? renderSelectFixRow('Application', 'application')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-initiative-type') && initiativeTypeFieldId
            ? renderSelectFixRow('Initiative Type', 'initiativeType')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-product-owner') && productOwnerFieldId
            ? (shouldUseProductOwnerUserSearch
              ? renderUserFixRow('Product Owner', 'productOwner')
              : renderSelectFixRow('Product Owner', 'productOwner'))
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-fix-version')
            ? renderSelectFixRow('Fix Version', 'fixVersion')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-due-date')
            ? renderDateFixRow('Due Date', 'dueDate')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'no-ac') && acceptanceCriteriaFieldId
            ? renderTextFixRow('Acceptance Criteria', 'acceptanceCriteria', 'Describe acceptance criteria', true)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'no-assignee')
            ? renderUserFixRow('Assignee', 'assignee')
            : null}
          {renderStoryPointFixRows()}
          {renderStatusTransitionRow()}

          <div className={styles.featureReviewSaveAllRow}>
            <button
              className={styles.featureReviewSaveAllButton}
              disabled={isSavingAllFixes || pendingFixCount === 0}
              onClick={() => void handleSaveAllFixes()}
              type="button"
            >
              {isSavingAllFixes ? 'Saving all fixes…' : 'Save all fixes'}
            </button>
            <span className={styles.featureReviewSaveAllHint}>
              {pendingFixCount === 0
                ? 'Fill in at least one fix to enable saving.'
                : `${pendingFixCount} fix${pendingFixCount === 1 ? '' : 'es'} ready — saved together, refreshes once.`}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Renders Team Dashboard feature rollup cards with shared hygiene badges for the currently selected PI. */
export default function FeatureReviewTab({
  boardId,
  boardName,
  projectKey,
  selectedPiName,
}: FeatureReviewTabProps) {
  const { showToast } = useToast();
  const storedArtTeams = useMemo(() => readStoredArtTeams(), []);
  const activeDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.sprintDashboardActiveTeamProfileId,
  );
  // The selected team's name disambiguates the ART team when several share a project key — without it
  // the rollup could show a different team's features (e.g. "Transformers" showing "Cleanup Crew").
  const activeTeamName = useSettingsStore(
    (storeState) => storeState.sprintDashboardTeamProfiles.find((profile) => profile.id === storeState.sprintDashboardActiveTeamProfileId)?.name ?? '',
  );
  const matchedArtTeam = useMemo(
    () => findMatchingArtTeam(storedArtTeams, boardId, projectKey, activeTeamName),
    [boardId, projectKey, storedArtTeams, activeTeamName],
  );
  const effectiveSelectedPiName = selectedPiName.trim() || readFallbackSelectedPiName();
  const customStoryPointsFieldId = loadDashboardConfigFromStorage(activeDashboardTeamProfileId).customStoryPointsFieldId ?? '';
  const boardLabel = readBoardLabel(boardName, boardId);
  const [featureReviewItems, setFeatureReviewItems] = useState<FeatureReviewItem[]>([]);
  const [featureReviewFieldConfig, setFeatureReviewFieldConfig] = useState<HygieneFieldConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadFeatureReviewData = useCallback(async () => {
    if (!matchedArtTeam) {
      setFeatureReviewItems([]);
      setFeatureReviewFieldConfig(null);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const resolvedFieldConfig = await fetchFeatureReviewFieldConfig();
      const reviewItems = await fetchFeatureReviewItems(
        {
          ...matchedArtTeam,
          sprintIssues: [],
          isLoading: false,
          loadError: null,
        } satisfies ArtTeam,
        effectiveSelectedPiName,
        resolvedFieldConfig,
        customStoryPointsFieldId,
      );
      setFeatureReviewFieldConfig(resolvedFieldConfig);
      setFeatureReviewItems(reviewItems);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to load Team Dashboard feature review.';
      setFeatureReviewItems([]);
      setFeatureReviewFieldConfig(null);
      setLoadError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [customStoryPointsFieldId, effectiveSelectedPiName, matchedArtTeam, showToast]);

  useEffect(() => {
    const loadTimeoutHandle = window.setTimeout(() => {
      void loadFeatureReviewData();
    }, 0);

    return () => {
      window.clearTimeout(loadTimeoutHandle);
    };
  }, [loadFeatureReviewData]);

  const flaggedFeatureCount = featureReviewItems.filter((featureReviewItem) => featureReviewItem.hygieneFlags.length > 0).length;
  const totalFlagCount = featureReviewItems.reduce(
    (flagCount, featureReviewItem) => flagCount + featureReviewItem.hygieneFlags.length,
    0,
  );

  if (!matchedArtTeam) {
    return (
      <section className={styles.piReviewAuthoringCard}>
        <h2 className={styles.settingsSectionTitle}>Feature Review</h2>
        <p className={styles.piReviewAuthoringText}>
          Team Dashboard can only build Feature Review after this board is matched to an ART team with saved ART settings.
        </p>
        <p className={styles.piReviewAuthoringText}>
          Current dashboard context: board <strong>{boardLabel}</strong>
          {projectKey.trim() !== '' ? <> in project <strong>{projectKey.trim().toUpperCase()}</strong></> : null}.
        </p>
        <a className={styles.piReviewAuthoringLink} href={ART_VIEW_ROUTE}>
          Open ART Settings
        </a>
      </section>
    );
  }

  return (
    <section className={styles.featureReviewSection}>
      <div className={styles.featureReviewHeader}>
        <div>
          <h2 className={styles.settingsSectionTitle}>Feature Review</h2>
          <p className={styles.piReviewAuthoringText}>{FEATURE_REVIEW_INTRO}</p>
        </div>
        <span className={styles.piReviewCapacityBadge}>Team feature view</span>
      </div>

      <div className={styles.piReviewCapacityMetaRow}>
        <span className={styles.piReviewCapacityMetaPill}>
          Team: <strong>{matchedArtTeam.name}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          Board context: <strong>{boardLabel}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          PI: <strong>{effectiveSelectedPiName || EMPTY_CONTEXT_LABEL}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          Features: <strong>{featureReviewItems.length}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          Flagged features: <strong>{flaggedFeatureCount}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          Hygiene flags: <strong>{totalFlagCount}</strong>
        </span>
      </div>

      {isLoading ? <p className={styles.piReviewAuthoringText}>Loading feature rollup and hygiene flags...</p> : null}
      {loadError ? <p className={styles.errorMessage}>{loadError}</p> : null}
      {!isLoading && !loadError && featureReviewItems.length === 0 ? (
        <p className={styles.piReviewAuthoringText}>No features were found for the selected PI and team context.</p>
      ) : null}

      {!isLoading && !loadError ? (
        <div className={styles.featureReviewCardGrid}>
          {featureReviewItems.map((featureReviewItem) => {
            const errorFlagCount = featureReviewItem.hygieneFlags.filter((hygieneFlag) => hygieneFlag.severity === 'error').length;
            const warningFlagCount = featureReviewItem.hygieneFlags.length - errorFlagCount;
            return (
              <article className={styles.featureReviewCard} key={featureReviewItem.feature.key}>
                <div className={styles.featureReviewCardHeader}>
                  <div className={styles.featureReviewTitleBlock}>
                    <div className={styles.featureReviewKeyRow}>
                      <a className={styles.featureReviewKey} href={readFeatureJiraBrowseUrl(featureReviewItem.feature.key)} rel="noreferrer" target="_blank">
                        {featureReviewItem.feature.key}
                      </a>
                      {featureReviewItem.feature.isExternal ? (
                        <span className={styles.featureReviewExternalBadge}>External feature</span>
                      ) : null}
                    </div>
                    <h3 className={styles.featureReviewTitle}>{featureReviewItem.feature.summary}</h3>
                    <div className={styles.featureReviewMetaRow}>
                      <span className={styles.featureReviewStatus}>{featureReviewItem.feature.status}</span>
                      <span className={`${styles.healthBadge} ${readHealthToneClassName(featureReviewItem.feature.health)}`}>
                        {HEALTH_LABELS[featureReviewItem.feature.health]}
                      </span>
                    </div>
                  </div>
                  <div className={styles.featureReviewProgressBlock}>
                    <span className={styles.featureReviewProgressValue}>{featureReviewItem.feature.completionPercent}%</span>
                    <span className={styles.featureReviewProgressLabel}>Complete</span>
                  </div>
                </div>

                <div className={styles.featureReviewStatsGrid}>
                  <div className={styles.featureReviewStatCard}>
                    <span className={styles.featureReviewStatValue}>{featureReviewItem.totalChildCount}</span>
                    <span className={styles.featureReviewStatLabel}>Child issues</span>
                  </div>
                  <div className={styles.featureReviewStatCard}>
                    <span className={styles.featureReviewStatValue}>{featureReviewItem.doneChildCount}</span>
                    <span className={styles.featureReviewStatLabel}>Done</span>
                  </div>
                  <div className={styles.featureReviewStatCard}>
                    <span className={styles.featureReviewStatValue}>{featureReviewItem.inFlightChildCount}</span>
                    <span className={styles.featureReviewStatLabel}>In flight</span>
                  </div>
                  <div className={styles.featureReviewStatCard}>
                    <span className={styles.featureReviewStatValue}>{featureReviewItem.blockedChildCount}</span>
                    <span className={styles.featureReviewStatLabel}>Blocked</span>
                  </div>
                  <div className={styles.featureReviewStatCard}>
                    <span className={styles.featureReviewStatValue}>{featureReviewItem.feature.offTrain.length}</span>
                    <span className={styles.featureReviewStatLabel}>Off train</span>
                  </div>
                  <div className={styles.featureReviewStatCard}>
                    <span className={styles.featureReviewStatValue}>{featureReviewItem.hygieneFlags.length}</span>
                    <span className={styles.featureReviewStatLabel}>Hygiene flags</span>
                  </div>
                </div>

                <div className={styles.featureReviewFlagSummaryRow}>
                  <span className={styles.featureReviewFlagSummaryText}>
                    {featureReviewItem.hygieneFlags.length === 0
                      ? 'This feature currently passes the tracked default hygiene checks.'
                      : `${errorFlagCount} errors and ${warningFlagCount} warnings need review.`}
                  </span>
                </div>

                <div className={styles.featureReviewFlagList}>
                  {featureReviewItem.hygieneFlags.length === 0 ? (
                    <span className={styles.featureReviewFlagClear}>Hygiene clean</span>
                  ) : (
                    featureReviewItem.hygieneFlags.map((hygieneFlag) => (
                      <span
                        className={`${styles.featureReviewFlagBadge} ${readHygieneToneClassName(hygieneFlag)}`}
                        key={`${featureReviewItem.feature.key}-${hygieneFlag.checkId}`}
                      >
                        {hygieneFlag.label}
                      </span>
                    ))
                  )}
                </div>

                {featureReviewItem.hygieneFlags.length > 0 && featureReviewFieldConfig ? (
                  <FeatureReviewQuickFixPanel
                    key={readQuickFixPanelResetKey(featureReviewItem, featureReviewFieldConfig)}
                    featureReviewFieldConfig={featureReviewFieldConfig}
                    featureReviewItem={featureReviewItem}
                    onFeatureFixed={loadFeatureReviewData}
                    showToast={showToast}
                  />
                ) : null}

                {[...featureReviewItem.feature.children, ...featureReviewItem.feature.offTrain].length > 0 ? (
                  <ul className={styles.featureReviewStoryList}>
                    {[...featureReviewItem.feature.children, ...featureReviewItem.feature.offTrain]
                      .slice(0, FEATURE_REVIEW_STORY_LIMIT)
                      .map((storyNode) => (
                        <li className={styles.featureReviewStoryRow} key={storyNode.key}>
                          <a className={styles.featureReviewStoryKey} href={readFeatureJiraBrowseUrl(storyNode.key)} rel="noreferrer" target="_blank">
                            {storyNode.key}
                          </a>
                          <span className={styles.featureReviewStorySummary}>{storyNode.summary}</span>
                          <span className={styles.featureReviewStoryMeta}>
                            {storyNode.issueType} - {storyNode.status}
                            {storyNode.isOffTrain ? ' - Off train' : ''}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className={styles.featureReviewEmptyChildren}>
                    No child issues were found under this feature for the current PI context.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
