// PiFeatureRemapPanel.tsx — Team Dashboard control for moving unplanned work from one PI's bucket
// Feature to another PI's, and copying the Program Increment across in the same pass.
//
// This is NOT the PI Review carryover: it handles UNPLANNED work that each PI collects under a single
// bucket Feature. At closeout, whatever is still open on that Feature rolls forward into the next PI's
// bucket. Both PIs are selectable, so any PI's bucket can be re-pointed to any other.

import { useEffect, useState } from 'react';

import { useToast } from '../../components/Toast/ToastContext.ts';
import styles from './SprintDashboardView.module.css';
import {
  executeFeatureRemap,
  fetchFeatureRemapCandidateIssues,
  fetchFeaturesForPi,
  type FeatureRemapCandidateIssue,
  type FeatureRemapFeatureOption,
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

/** Renders the Team Dashboard control that moves unplanned-work issues from one PI's Feature to another. */
export default function PiFeatureRemapPanel({
  projectKey,
  selectedPiName,
}: PiFeatureRemapPanelProps) {
  const { showToast } = useToast();
  const [piOptions, setPiOptions] = useState<FeatureRemapPiOptions | null>(null);
  const [sourcePiName, setSourcePiName] = useState('');
  const [targetPiName, setTargetPiName] = useState('');
  const [sourceFeatures, setSourceFeatures] = useState<FeatureRemapFeatureOption[]>([]);
  const [targetFeatures, setTargetFeatures] = useState<FeatureRemapFeatureOption[]>([]);
  const [sourceFeatureKey, setSourceFeatureKey] = useState('');
  const [targetFeatureKey, setTargetFeatureKey] = useState('');
  const [previewIssues, setPreviewIssues] = useState<FeatureRemapCandidateIssue[] | null>(null);
  const [isLoadingPiOptions, setIsLoadingPiOptions] = useState(false);
  const [isLoadingSourceFeatures, setIsLoadingSourceFeatures] = useState(false);
  const [isLoadingTargetFeatures, setIsLoadingTargetFeatures] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultState, setResultState] = useState<FeatureRemapResultState | null>(null);

  const normalizedProjectKey = projectKey.trim().toUpperCase();

  // ── Load the PI list and the intelligent closeout defaults (source = this PI, target = the next) ──
  useEffect(() => {
    let isCancelled = false;

    async function loadPiOptions(): Promise<void> {
      if (normalizedProjectKey === '') {
        setPiOptions(null);
        setSourcePiName('');
        setTargetPiName('');
        return;
      }

      setIsLoadingPiOptions(true);
      try {
        const loadedPiOptions = await fetchFeatureRemapPiOptions(normalizedProjectKey, selectedPiName);
        if (isCancelled) return;
        setPiOptions(loadedPiOptions);
        setSourcePiName((current) => (loadedPiOptions.allPiNames.includes(current) ? current : loadedPiOptions.defaultSourcePiName));
        setTargetPiName((current) => (loadedPiOptions.allPiNames.includes(current) ? current : loadedPiOptions.defaultTargetPiName));
      } catch (error) {
        if (isCancelled) return;
        setPiOptions(null);
        showToast(error instanceof Error ? error.message : 'Unable to load the PI list.', 'error');
      } finally {
        if (!isCancelled) setIsLoadingPiOptions(false);
      }
    }

    void loadPiOptions();
    return () => { isCancelled = true; };
  }, [normalizedProjectKey, selectedPiName, showToast]);

  // ── Load the chosen source PI's Features ──
  useEffect(() => {
    let isCancelled = false;

    async function loadSourceFeatures(): Promise<void> {
      if (normalizedProjectKey === '' || sourcePiName === '') {
        setSourceFeatures([]);
        setSourceFeatureKey('');
        return;
      }
      setIsLoadingSourceFeatures(true);
      try {
        const features = await fetchFeaturesForPi(normalizedProjectKey, sourcePiName);
        if (isCancelled) return;
        setSourceFeatures(features);
        setSourceFeatureKey((current) => (features.some((option) => option.key === current) ? current : features[0]?.key ?? ''));
      } catch (error) {
        if (!isCancelled) {
          setSourceFeatures([]);
          showToast(error instanceof Error ? error.message : `Unable to load ${sourcePiName} Features.`, 'error');
        }
      } finally {
        if (!isCancelled) setIsLoadingSourceFeatures(false);
      }
    }

    void loadSourceFeatures();
    return () => { isCancelled = true; };
  }, [normalizedProjectKey, sourcePiName, showToast]);

  // ── Load the chosen target PI's Features ──
  useEffect(() => {
    let isCancelled = false;

    async function loadTargetFeatures(): Promise<void> {
      if (normalizedProjectKey === '' || targetPiName === '') {
        setTargetFeatures([]);
        setTargetFeatureKey('');
        return;
      }
      setIsLoadingTargetFeatures(true);
      try {
        const features = await fetchFeaturesForPi(normalizedProjectKey, targetPiName);
        if (isCancelled) return;
        setTargetFeatures(features);
        setTargetFeatureKey((current) => (features.some((option) => option.key === current) ? current : features[0]?.key ?? ''));
      } catch (error) {
        if (!isCancelled) {
          setTargetFeatures([]);
          showToast(error instanceof Error ? error.message : `Unable to load ${targetPiName} Features.`, 'error');
        }
      } finally {
        if (!isCancelled) setIsLoadingTargetFeatures(false);
      }
    }

    void loadTargetFeatures();
    return () => { isCancelled = true; };
  }, [normalizedProjectKey, targetPiName, showToast]);

  // ── Preview the open child issues on the chosen source Feature ──
  useEffect(() => {
    let isCancelled = false;

    async function loadPreviewIssues(): Promise<void> {
      const normalizedSourceFeatureKey = sourceFeatureKey.trim().toUpperCase();
      if (normalizedProjectKey === '' || normalizedSourceFeatureKey === '') {
        setPreviewIssues(null);
        return;
      }
      setIsLoadingPreview(true);
      try {
        const matchedIssues = await fetchFeatureRemapCandidateIssues(normalizedProjectKey, normalizedSourceFeatureKey);
        if (!isCancelled) setPreviewIssues(matchedIssues);
      } catch (error) {
        if (!isCancelled) {
          setPreviewIssues([]);
          showToast(error instanceof Error ? error.message : 'Unable to load the open child issue preview.', 'error');
        }
      } finally {
        if (!isCancelled) setIsLoadingPreview(false);
      }
    }

    void loadPreviewIssues();
    return () => { isCancelled = true; };
  }, [normalizedProjectKey, sourceFeatureKey, showToast]);

  async function handleRemap(): Promise<void> {
    const normalizedSourceFeatureKey = sourceFeatureKey.trim().toUpperCase();
    const normalizedTargetFeatureKey = targetFeatureKey.trim().toUpperCase();

    if (normalizedProjectKey === '' || normalizedSourceFeatureKey === '' || normalizedTargetFeatureKey === '') {
      showToast('Pick a source Feature and a target Feature before moving unplanned work.', 'warning');
      return;
    }
    if (normalizedSourceFeatureKey === normalizedTargetFeatureKey) {
      showToast('Choose a different target Feature so the issues actually move.', 'warning');
      return;
    }

    setIsSubmitting(true);
    setResultState(null);
    try {
      const matchedIssues = previewIssues ?? await fetchFeatureRemapCandidateIssues(normalizedProjectKey, normalizedSourceFeatureKey);
      if (matchedIssues.length === 0) {
        setResultState({ matchedIssues: [], movedIssueKeys: [], failedIssueKeys: [], failureMessages: [], targetPiValue: '' });
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
      showToast('The unplanned-work move could not update any issues.', 'error');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The unplanned-work move failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  const allPiNames = piOptions?.allPiNames ?? [];

  return (
    <section className={styles.piCloseoutRemapSection}>
      <div className={styles.piCloseoutRemapHeader}>
        <div>
          <h2 className={styles.settingsSectionTitle}>Unplanned Work Mapping</h2>
          <p className={styles.piCloseoutRemapText}>
            Each PI collects unplanned work under a single bucket Feature. At closeout, move whatever is still open
            from one PI&apos;s Feature to another&apos;s and copy the Program Increment across in the same pass. Both
            PIs are selectable, so any PI&apos;s bucket can be re-pointed to any other.
          </p>
        </div>
        <span className={styles.piReviewCapacityBadge}>PI closeout</span>
      </div>

      <div className={styles.piReviewCapacityMetaRow}>
        <span className={styles.piReviewCapacityMetaPill}>
          Project: <strong>{normalizedProjectKey || 'Not selected'}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          From PI: <strong>{sourcePiName || 'Not selected'}</strong>
        </span>
        <span className={styles.piReviewCapacityMetaPill}>
          To PI: <strong>{targetPiName || 'Not selected'}</strong>
        </span>
      </div>

      <div className={styles.piCloseoutRemapGrid}>
        <label className={styles.scopeSelectorField}>
          From PI
          <select
            className={styles.piCloseoutRemapInput}
            aria-label="Source PI"
            disabled={isLoadingPiOptions || allPiNames.length === 0}
            onChange={(event) => setSourcePiName(event.target.value)}
            value={sourcePiName}
          >
            <option value="">Select source PI</option>
            {allPiNames.map((piName) => (
              <option key={piName} value={piName}>{piName}</option>
            ))}
          </select>
        </label>
        <label className={styles.scopeSelectorField}>
          To PI
          <select
            className={styles.piCloseoutRemapInput}
            aria-label="Target PI"
            disabled={isLoadingPiOptions || allPiNames.length === 0}
            onChange={(event) => setTargetPiName(event.target.value)}
            value={targetPiName}
          >
            <option value="">Select target PI</option>
            {allPiNames.map((piName) => (
              <option key={piName} value={piName}>{piName}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.piCloseoutRemapGrid}>
        <label className={styles.scopeSelectorField}>
          Source Feature ({sourcePiName || 'source PI'})
          <select
            className={styles.piCloseoutRemapInput}
            aria-label="Source Feature"
            disabled={isLoadingSourceFeatures || sourceFeatures.length === 0}
            onChange={(event) => setSourceFeatureKey(event.target.value)}
            value={sourceFeatureKey}
          >
            <option value="">Select source Feature</option>
            {sourceFeatures.map((featureOption) => (
              <option key={featureOption.key} value={featureOption.key}>
                {featureOption.key} - {featureOption.summary}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.scopeSelectorField}>
          Target Feature ({targetPiName || 'target PI'})
          <select
            className={styles.piCloseoutRemapInput}
            aria-label="Target Feature"
            disabled={isLoadingTargetFeatures || targetFeatures.length === 0}
            onChange={(event) => setTargetFeatureKey(event.target.value)}
            value={targetFeatureKey}
          >
            <option value="">Select target Feature</option>
            {targetFeatures.map((featureOption) => (
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
            ? 'Loading the project’s PIs…'
            : 'Select a source Feature to preview the open child records that will be re-mapped.'}
        </p>

        {sourceFeatureKey ? (
          isLoadingPreview ? (
            <p className={styles.piCloseoutRemapSummary}>Loading child record preview&hellip;</p>
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
            <p className={styles.piCloseoutRemapSummary}>No open child records were found on the selected source Feature.</p>
          )
        ) : null}
      </div>

      <div className={styles.piCloseoutRemapActions}>
        <button
          className={styles.piCloseoutRemapButton}
          disabled={isSubmitting || isLoadingPiOptions || isLoadingPreview}
          onClick={() => void handleRemap()}
          type="button"
        >
          {isSubmitting ? 'Moving unplanned work…' : 'Move open child issues'}
        </button>
      </div>

      {resultState ? (
        <div className={styles.piCloseoutRemapResults}>
          <p className={styles.piCloseoutRemapSummary}>
            {resultState.matchedIssues.length === 0
              ? 'No matching open child issues were found on the source Feature.'
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
