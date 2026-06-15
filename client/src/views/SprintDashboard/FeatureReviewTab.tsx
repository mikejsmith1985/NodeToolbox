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

function FeatureReviewQuickFixPanel({
  featureReviewFieldConfig,
  featureReviewItem,
  onFeatureFixed,
  showToast,
}: FeatureReviewQuickFixPanelProps) {
  const [isFixPanelOpen, setIsFixPanelOpen] = useState(false);
  const [isLoadingEditMeta, setIsLoadingEditMeta] = useState(false);
  const [isSavingFieldKey, setIsSavingFieldKey] = useState<string | null>(null);
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

  async function runFixAction(fieldKey: string, saveAction: () => Promise<void>, successMessage: string) {
    setIsSavingFieldKey(fieldKey);
    setSaveMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: null }));
    setIsErrorMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: false }));
    try {
      await saveAction();
      setSaveMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: successMessage }));
      showToast(successMessage, 'success');
      await onFeatureFixed();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Unable to save ${fieldKey}.`;
      setSaveMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: errorMessage }));
      setIsErrorMessageByFieldKey((currentMessages) => ({ ...currentMessages, [fieldKey]: true }));
      showToast(errorMessage, 'error');
    } finally {
      setIsSavingFieldKey(null);
    }
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
    saveHandler: () => Promise<void>,
    isMultiline = false,
  ) {
    const inputValue = fieldDraftByKey[fieldKey] ?? '';
    const isSavingCurrentField = isSavingFieldKey === fieldKey;
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
        <div className={styles.featureReviewFixActionRow}>
          <button
            className={styles.secondaryButton}
            disabled={inputValue.trim() === '' || isSavingCurrentField}
            onClick={() => void runFixAction(fieldKey, saveHandler, `${featureIssue.key} updated.`)}
            type="button"
          >
            {isSavingCurrentField ? 'Saving…' : 'Save'}
          </button>
          {renderSaveStateMessage(saveMessage, isErrorMessage)}
        </div>
      </div>
    );
  }

  function renderDateFixRow(label: string, fieldKey: string, fieldId: string) {
    const inputValue = fieldDraftByKey[fieldKey] ?? '';
    const isSavingCurrentField = isSavingFieldKey === fieldKey;
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
        <div className={styles.featureReviewFixActionRow}>
          <button
            className={styles.secondaryButton}
            disabled={inputValue.trim() === '' || isSavingCurrentField}
            onClick={() => void runFixAction(fieldKey, async () => saveFeatureReviewSimpleField(featureIssue.key, fieldId, inputValue), `${featureIssue.key} updated.`)}
            type="button"
          >
            {isSavingCurrentField ? 'Saving…' : 'Save'}
          </button>
          {renderSaveStateMessage(saveMessage, isErrorMessage)}
        </div>
      </div>
    );
  }

  function renderSelectFixRow(label: string, fieldKey: string, fieldId: string) {
    const selectOptions = fieldKey === 'fixVersion'
      ? fixVersionOptions
      : readSelectableFieldOptions(fieldKey, editMetaFields, featureReviewFieldConfig);
    const inputValue = fieldDraftByKey[fieldKey] ?? '';
    const isSavingCurrentField = isSavingFieldKey === fieldKey;
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
        <div className={styles.featureReviewFixActionRow}>
          <button
            className={styles.secondaryButton}
            disabled={inputValue.trim() === '' || isSavingCurrentField}
            onClick={() => void runFixAction(
              fieldKey,
              async () => (
                fieldKey === 'fixVersion'
                  ? saveFeatureReviewFixVersion(featureIssue.key, inputValue)
                  : saveFeatureReviewOptionField(featureIssue.key, fieldId, inputValue, editMetaFields[fieldId])
              ),
              `${featureIssue.key} updated.`,
            )}
            type="button"
          >
            {isSavingCurrentField ? 'Saving…' : 'Save'}
          </button>
          {renderSaveStateMessage(saveMessage, isErrorMessage)}
        </div>
      </div>
    );
  }

  function renderUserFixRow(label: string, fieldKey: string, fieldId: string) {
    const searchValue = userSearchQueryByFieldKey[fieldKey] ?? '';
    const selectedUserIdentifier = fieldDraftByKey[fieldKey] ?? '';
    const isSavingCurrentField = isSavingFieldKey === fieldKey;
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
        <div className={styles.featureReviewFixActionRow}>
          <button
            className={styles.secondaryButton}
            disabled={selectedUserIdentifier.trim() === '' || isSavingCurrentField}
            onClick={() => void runFixAction(fieldKey, async () => saveFeatureReviewUserField(featureIssue.key, fieldId, selectedUserIdentifier), `${featureIssue.key} updated.`)}
            type="button"
          >
            {isSavingCurrentField ? 'Saving…' : 'Save'}
          </button>
          {renderSaveStateMessage(saveMessage, isErrorMessage)}
        </div>
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
          const isSavingCurrentField = isSavingFieldKey === saveKey;
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
                <button
                  className={styles.secondaryButton}
                  disabled={draftValue.trim() === '' || isSavingCurrentField}
                  onClick={() => void runFixAction(
                    saveKey,
                    async () => saveFeatureReviewStoryPoints(storyNode.key, draftValue),
                    `${storyNode.key} story points updated.`,
                  )}
                  type="button"
                >
                  {isSavingCurrentField ? 'Saving…' : 'Save'}
                </button>
              </div>
              {renderSaveStateMessage(saveMessage, isErrorMessage)}
            </div>
          );
        })}
      </div>
    );
  }

  function renderStatusTransitionRow() {
    const isSavingCurrentField = isSavingFieldKey === STATUS_TRANSITION_FIELD_KEY;
    const saveMessage = saveMessageByFieldKey[STATUS_TRANSITION_FIELD_KEY] ?? null;
    const isErrorMessage = isErrorMessageByFieldKey[STATUS_TRANSITION_FIELD_KEY] ?? false;

    return (
      <div className={styles.featureReviewFixRow} key={STATUS_TRANSITION_FIELD_KEY}>
        <label className={styles.featureReviewFixLabel}>
          <span>Change Status</span>
          <select
            aria-label="Change Status"
            className={styles.settingsInput}
            disabled={isLoadingEditMeta || isSavingCurrentField || availableTransitions.length === 0}
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
        <div className={styles.featureReviewFixActionRow}>
          <button
            className={styles.secondaryButton}
            disabled={selectedTransitionId.trim() === '' || isSavingCurrentField}
            onClick={() => void runFixAction(
              STATUS_TRANSITION_FIELD_KEY,
              async () => {
                await saveFeatureReviewTransition(featureIssue.key, selectedTransitionId);
                setSelectedTransitionId('');
              },
              `${featureIssue.key} status updated.`,
            )}
            type="button"
          >
            {isSavingCurrentField ? 'Saving…' : 'Save Status'}
          </button>
          {renderSaveStateMessage(saveMessage, isErrorMessage)}
        </div>
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
            ? renderTextFixRow('Feature name / summary', 'summary', 'Enter feature summary', async () => saveFeatureReviewSimpleField(featureIssue.key, 'summary', fieldDraftByKey.summary ?? ''))
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-parent-link') && parentLinkFieldId
            ? renderTextFixRow('Parent link', 'parentLink', 'Enter parent issue key', async () => saveFeatureReviewIssueLinkField(featureIssue.key, parentLinkFieldId, fieldDraftByKey.parentLink ?? ''))
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-pi') && programIncrementFieldId
            ? renderSelectFixRow('Program Increment', 'programIncrement', programIncrementFieldId)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-target-start') && targetStartFieldId
            ? renderDateFixRow('Target Start', 'targetStart', targetStartFieldId)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-target-end') && targetEndFieldId
            ? renderDateFixRow('Target End', 'targetEnd', targetEndFieldId)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-application') && applicationFieldId
            ? renderSelectFixRow('Application', 'application', applicationFieldId)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-initiative-type') && initiativeTypeFieldId
            ? renderSelectFixRow('Initiative Type', 'initiativeType', initiativeTypeFieldId)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-product-owner') && productOwnerFieldId
            ? (shouldUseProductOwnerUserSearch
              ? renderUserFixRow('Product Owner', 'productOwner', productOwnerFieldId)
              : renderSelectFixRow('Product Owner', 'productOwner', productOwnerFieldId))
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-fix-version')
            ? renderSelectFixRow('Fix Version', 'fixVersion', 'fixVersions')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'missing-due-date')
            ? renderDateFixRow('Due Date', 'dueDate', 'duedate')
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'no-ac') && acceptanceCriteriaFieldId
            ? renderTextFixRow('Acceptance Criteria', 'acceptanceCriteria', 'Describe acceptance criteria', async () => saveFeatureReviewSimpleField(featureIssue.key, acceptanceCriteriaFieldId, fieldDraftByKey.acceptanceCriteria ?? ''), true)
            : null}
          {hasHygieneFlag(featureReviewItem.hygieneFlags, 'no-assignee')
            ? renderUserFixRow('Assignee', 'assignee', 'assignee')
            : null}
          {renderStoryPointFixRows()}
          {renderStatusTransitionRow()}
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
  const matchedArtTeam = useMemo(
    () => findMatchingArtTeam(storedArtTeams, boardId, projectKey),
    [boardId, projectKey, storedArtTeams],
  );
  const effectiveSelectedPiName = selectedPiName.trim() || readFallbackSelectedPiName();
  const activeDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.sprintDashboardActiveTeamProfileId,
  );
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
