// PiFeatureRemapPanel.tsx — Team Dashboard closeout controls for moving open child issues from one feature to another.

import { useEffect, useState } from 'react';

import { useToast } from '../../components/Toast/ToastContext.ts';
import styles from './SprintDashboardView.module.css';
import {
  executeFeatureRemap,
  fetchFeatureRemapCandidateIssues,
  type FeatureRemapCandidateIssue,
  type FeatureRemapPiOptions,
  fetchFeatureRemapPiOptions,
} from './piFeatureRemap.ts';

interface PiFeatureRemapPanelProps {
  projectKey: string;
  selectedPiName: string;
}

interface FeatureRemapResultState {
  matchedIssues: FeatureRemapCandidateIssue[];
  movedIssueKeys: string[];
  failedIssueKeys: string[];
  failureMessages: string[];
  targetPiValue: string;
}

/** Renders the Team Dashboard PI closeout control that remaps open child issues to the next feature and PI. */
export default function PiFeatureRemapPanel({
  projectKey,
  selectedPiName,
}: PiFeatureRemapPanelProps) {
  const { showToast } = useToast();
  const [piOptions, setPiOptions] = useState<FeatureRemapPiOptions | null>(null);
  const [sourceFeatureKey, setSourceFeatureKey] = useState('');
  const [targetFeatureKey, setTargetFeatureKey] = useState('');
  const [previewIssues, setPreviewIssues] = useState<FeatureRemapCandidateIssue[] | null>(null);
  const [isLoadingPiOptions, setIsLoadingPiOptions] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultState, setResultState] = useState<FeatureRemapResultState | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadPiOptions(): Promise<void> {
      const normalizedProjectKey = projectKey.trim().toUpperCase();
      if (normalizedProjectKey === '') {
        setPiOptions(null);
        setSourceFeatureKey('');
        setTargetFeatureKey('');
        return;
      }

      setIsLoadingPiOptions(true);
      try {
        const loadedPiOptions = await fetchFeatureRemapPiOptions(normalizedProjectKey, selectedPiName);
        if (isCancelled) {
          return;
        }

        setPiOptions(loadedPiOptions);
        setSourceFeatureKey((currentSourceFeatureKey) =>
          loadedPiOptions.priorPiFeatures.some((featureOption) => featureOption.key === currentSourceFeatureKey)
            ? currentSourceFeatureKey
            : loadedPiOptions.priorPiFeatures[0]?.key ?? '',
        );
        setTargetFeatureKey((currentTargetFeatureKey) => {
          if (loadedPiOptions.currentPiFeatures.some((featureOption) => featureOption.key === currentTargetFeatureKey)) {
            return currentTargetFeatureKey;
          }

          return loadedPiOptions.currentPiFeatures[0]?.key ?? '';
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setPiOptions(null);
        showToast(error instanceof Error ? error.message : 'Unable to load PI carryover feature options.', 'error');
      } finally {
        if (!isCancelled) {
          setIsLoadingPiOptions(false);
        }
      }
    }

    void loadPiOptions();
    return () => {
      isCancelled = true;
    };
  }, [projectKey, selectedPiName, showToast]);

  useEffect(() => {
    let isCancelled = false;

    async function loadPreviewIssues(): Promise<void> {
      const normalizedProjectKey = projectKey.trim().toUpperCase();
      const normalizedSourceFeatureKey = sourceFeatureKey.trim().toUpperCase();
      if (normalizedProjectKey === '' || normalizedSourceFeatureKey === '') {
        setPreviewIssues(null);
        return;
      }

      setIsLoadingPreview(true);
      try {
        const matchedIssues = await fetchFeatureRemapCandidateIssues(normalizedProjectKey, normalizedSourceFeatureKey);
        if (!isCancelled) {
          setPreviewIssues(matchedIssues);
        }
      } catch (error) {
        if (!isCancelled) {
          setPreviewIssues([]);
          showToast(error instanceof Error ? error.message : 'Unable to load carryover child issue preview.', 'error');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPreview(false);
        }
      }
    }

    void loadPreviewIssues();
    return () => {
      isCancelled = true;
    };
  }, [projectKey, sourceFeatureKey, showToast]);

  async function handleCarryoverRemap(): Promise<void> {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const normalizedSourceFeatureKey = sourceFeatureKey.trim().toUpperCase();
    const normalizedTargetFeatureKey = targetFeatureKey.trim().toUpperCase();

    if (normalizedProjectKey === '' || normalizedSourceFeatureKey === '' || normalizedTargetFeatureKey === '') {
      showToast('Enter the old feature and new feature before running carryover remap.', 'warning');
      return;
    }

    if (normalizedSourceFeatureKey === normalizedTargetFeatureKey) {
      showToast('Choose a different target feature so carryover issues actually move.', 'warning');
      return;
    }

    setIsSubmitting(true);
    setResultState(null);

    try {
      const matchedIssues = previewIssues ?? await fetchFeatureRemapCandidateIssues(normalizedProjectKey, normalizedSourceFeatureKey);
      if (matchedIssues.length === 0) {
        setResultState({
          matchedIssues: [],
          movedIssueKeys: [],
          failedIssueKeys: [],
          failureMessages: [],
          targetPiValue: '',
        });
        showToast(`No open child issues were found under ${normalizedSourceFeatureKey}.`, 'info');
        return;
      }

      const executionResult = await executeFeatureRemap(matchedIssues, normalizedTargetFeatureKey);
      setResultState({
        matchedIssues,
        movedIssueKeys: executionResult.movedIssueKeys,
        failedIssueKeys: executionResult.failedIssueKeys,
        failureMessages: executionResult.failureMessages,
        targetPiValue: executionResult.targetPiValue,
      });

      if (executionResult.failedIssueKeys.length === 0) {
        showToast(
          `Moved ${executionResult.movedIssueKeys.length} open child issues to ${normalizedTargetFeatureKey} and copied Program Increment ${executionResult.targetPiValue}.`,
          'success',
        );
        return;
      }

      if (executionResult.movedIssueKeys.length > 0) {
        showToast(
          `Moved ${executionResult.movedIssueKeys.length} issues to ${normalizedTargetFeatureKey} with Program Increment ${executionResult.targetPiValue}, but ${executionResult.failedIssueKeys.length} updates still need attention.`,
          'warning',
        );
        return;
      }

      showToast('The carryover remap could not update any issues.', 'error');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The carryover remap failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.piCloseoutRemapSection}>
      <div className={styles.piCloseoutRemapHeader}>
        <div>
          <h2 className={styles.settingsSectionTitle}>PI carryover remap</h2>
          <p className={styles.piCloseoutRemapText}>
            Move every non-done child issue from the closing feature to the next feature and copy the Program Increment directly from that new feature in the same pass.
          </p>
        </div>
        <span className={styles.piReviewCapacityBadge}>PI closeout</span>
      </div>

      <div className={styles.piReviewCapacityMetaRow}>
        <span className={styles.piReviewCapacityMetaPill}>
          Project: <strong>{projectKey.trim().toUpperCase() || 'Not selected'}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          Old PI: <strong>{piOptions?.priorPiName ?? 'Not found'}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          New PI: <strong>{piOptions?.currentPiName ?? 'Not found'}</strong>
        </span>
      </div>

      <div className={styles.piCloseoutRemapGrid}>
        <label className={styles.scopeSelectorField}>
          Old feature ({piOptions?.priorPiName ?? 'Prior PI'})
          <select
            className={styles.piCloseoutRemapInput}
            disabled={isLoadingPiOptions || (piOptions?.priorPiFeatures.length ?? 0) === 0}
            onChange={(event) => setSourceFeatureKey(event.target.value)}
            value={sourceFeatureKey}
          >
            <option value="">Select prior-PI feature</option>
            {(piOptions?.priorPiFeatures ?? []).map((featureOption) => (
              <option key={featureOption.key} value={featureOption.key}>
                {featureOption.key} - {featureOption.summary}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.scopeSelectorField}>
          New feature ({piOptions?.currentPiName ?? 'Current PI'})
          <select
            className={styles.piCloseoutRemapInput}
            disabled={isLoadingPiOptions || (piOptions?.currentPiFeatures.length ?? 0) === 0}
            onChange={(event) => setTargetFeatureKey(event.target.value)}
            value={targetFeatureKey}
          >
            <option value="">Select current-PI feature</option>
            {(piOptions?.currentPiFeatures ?? []).map((featureOption) => (
              <option key={featureOption.key} value={featureOption.key}>
                {featureOption.key} - {featureOption.summary}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.piCloseoutRemapResults}>
        <p className={styles.piCloseoutRemapSummary}>
          {isLoadingPiOptions
            ? 'Loading prior and current PI feature options...'
            : 'Select an old feature to preview the child records that will be re-mapped.'}
        </p>

        {sourceFeatureKey ? (
          isLoadingPreview ? (
            <p className={styles.piCloseoutRemapSummary}>Loading child record preview...</p>
          ) : previewIssues && previewIssues.length > 0 ? (
            <ul className={styles.piCloseoutRemapIssueList}>
              {previewIssues.map((matchedIssue) => (
                <li className={styles.piCloseoutRemapIssueRow} key={matchedIssue.key}>
                  <span className={styles.piCloseoutRemapIssueKey}>{matchedIssue.key}</span>
                  <span className={styles.piCloseoutRemapIssueSummary}>{matchedIssue.summary}</span>
                  <span className={styles.piCloseoutRemapIssueMeta}>
                    {matchedIssue.issueTypeName} - {matchedIssue.statusName}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.piCloseoutRemapSummary}>No open child records were found for the selected old feature.</p>
          )
        ) : null}
      </div>

      <div className={styles.piCloseoutRemapActions}>
        <button
          className={styles.piCloseoutRemapButton}
          disabled={isSubmitting || isLoadingPiOptions || isLoadingPreview}
          onClick={() => void handleCarryoverRemap()}
          type="button"
        >
          {isSubmitting ? 'Moving carryover issues...' : 'Move open child issues'}
        </button>
      </div>

      {resultState ? (
        <div className={styles.piCloseoutRemapResults}>
          <p className={styles.piCloseoutRemapSummary}>
            {resultState.matchedIssues.length === 0
              ? 'No matching open child issues were found for the old feature.'
              : `Matched ${resultState.matchedIssues.length} open child issues. Updated ${resultState.movedIssueKeys.length} and left ${resultState.failedIssueKeys.length} requiring follow-up. Copied Program Increment ${resultState.targetPiValue}.`}
          </p>

          {resultState.matchedIssues.length > 0 ? (
            <ul className={styles.piCloseoutRemapIssueList}>
              {resultState.matchedIssues.map((matchedIssue) => {
                const isSuccessfulMove = resultState.movedIssueKeys.includes(matchedIssue.key);
                return (
                  <li className={styles.piCloseoutRemapIssueRow} key={matchedIssue.key}>
                    <span className={styles.piCloseoutRemapIssueKey}>{matchedIssue.key}</span>
                    <span className={styles.piCloseoutRemapIssueSummary}>{matchedIssue.summary}</span>
                    <span className={styles.piCloseoutRemapIssueMeta}>
                      {matchedIssue.issueTypeName} - {matchedIssue.statusName}
                    </span>
                    <span className={isSuccessfulMove ? styles.piCloseoutRemapIssueSuccess : styles.piCloseoutRemapIssueWarning}>
                      {isSuccessfulMove ? 'Updated' : 'Needs follow-up'}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {resultState.failureMessages.length > 0 ? (
            <ul className={styles.piCloseoutRemapFailureList}>
              {resultState.failureMessages.map((failureMessage) => (
                <li key={failureMessage}>{failureMessage}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
