// FeatureSplitterTab.tsx — Break one large Feature into smaller Features that each deliver value.
//
// The shape of the tab mirrors how the job is actually done: the original sits on the left to copy from,
// the increments being written sit on the right, and the coaching is always visible underneath.
//
// Nothing here writes to Jira. The PO loads, edits, reviews a diff of every create and link, and only
// then commits. Everything short of that button is local (FR-014, SC-006).

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getIssueTypeFields } from '../../services/jiraApi.ts';
import type { CreateMetaFieldEntry } from '../../types/jira.ts';
import { useToast } from '../../components/Toast/ToastContext.ts';
import { GOOD_INCREMENT_TESTS, SPLIT_HEURISTICS } from './coaching/splitHeuristics';
import {
  createEmptyIncrement,
  createEmptySplitDraft,
  type ProposedIncrement,
  type SplitDraft,
} from './drafts/draftModel';
import {
  canPersistDrafts,
  deriveSplitScopeKey,
  discardSplitDraft,
  loadSplitDraft,
  saveSplitDraft,
} from './drafts/splitDraftStorage';
import { usePoHygieneContext } from './hooks/usePoHygieneContext';
import { buildSplitCommit, canCommitSplit } from './jira/buildSplitCommit';
import { loadIssueLinkTypeNames, loadSourceFeature } from './jira/loadSourceFeature';
import { runSplitCommit, type CommitOutcome } from './jira/runCommit';
import type { JiraIssue as HygieneIssue } from '../Hygiene/checks/hygieneChecks';
import styles from './FeatureSplitterTab.module.css';

interface FeatureSplitterTabProps {
  /** The PO Tool's own team profile — scopes drafts and the hygiene rules applied. */
  dashboardTeamProfileId: string;
}

/** Mints an id unique within the draft, so React keys and accept/reject stay stable. */
function mintIncrementId(existingIncrements: readonly ProposedIncrement[]): string {
  const usedIds = new Set(existingIncrements.map((increment) => increment.localId));
  let candidateIndex = existingIncrements.length + 1;
  while (usedIds.has(`increment-${candidateIndex}`)) {
    candidateIndex += 1;
  }
  return `increment-${candidateIndex}`;
}

/** Shapes an increment as an issue so the shared hygiene engine can grade it before it exists. */
function buildIncrementAsIssue(
  increment: ProposedIncrement,
  draft: SplitDraft,
  acceptanceCriteriaFieldId: string | null,
): HygieneIssue {
  const fields: Record<string, unknown> = {
    summary: increment.summary,
    description: increment.description,
    issuetype: { name: draft.sourceSnapshot?.issueTypeName ?? 'Feature' },
    status: { name: 'To Do', statusCategory: { key: 'new' } },
  };
  if (acceptanceCriteriaFieldId) {
    fields[acceptanceCriteriaFieldId] = increment.acceptanceCriteria;
  }
  return { key: increment.localId, fields } as HygieneIssue;
}

/** The PO's workspace for splitting one Feature. */
export default function FeatureSplitterTab({ dashboardTeamProfileId }: FeatureSplitterTabProps) {
  const { showToast } = useToast();
  const { evaluateDraft, fieldConfig, fieldConfigError } = usePoHygieneContext(dashboardTeamProfileId);

  const [featureKeyInput, setFeatureKeyInput] = useState('');
  const [draft, setDraft] = useState<SplitDraft>(() =>
    createEmptySplitDraft(dashboardTeamProfileId, deriveSplitScopeKey('')),
  );
  const [isLoadingFeature, setIsLoadingFeature] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableLinkTypeNames, setAvailableLinkTypeNames] = useState<string[]>([]);
  const [requiredFieldDescriptors, setRequiredFieldDescriptors] = useState<CreateMetaFieldEntry[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitOutcome, setCommitOutcome] = useState<CommitOutcome | null>(null);

  // Storage can be blocked (private browsing) or fill up. A PO must be told BEFORE they spend an hour
  // authoring, not after a refresh throws it away.
  const [canPersist] = useState(canPersistDrafts);

  // The instance's link types are a fact about Jira, not about this draft — fetch once.
  useEffect(() => {
    let isActive = true;
    loadIssueLinkTypeNames()
      .then((linkTypeNames) => {
        if (isActive) {
          setAvailableLinkTypeNames(linkTypeNames);
        }
      })
      .catch(() => {
        // A missing link-type list only costs the picker; the split itself still works.
        if (isActive) {
          setAvailableLinkTypeNames([]);
        }
      });
    return () => {
      isActive = false;
    };
  }, []);

  /** Persists and keeps the in-memory draft authoritative even when storage refuses. */
  const updateDraft = useCallback((nextDraft: SplitDraft) => {
    const stampedDraft = { ...nextDraft, updatedAtIso: new Date().toISOString() };
    setDraft(stampedDraft);
    saveSplitDraft(stampedDraft);
  }, []);

  const acceptanceCriteriaFieldId = useMemo(
    () => fieldConfig.acceptanceCriteriaFieldIds.find((fieldId) => fieldId !== 'description') ?? null,
    [fieldConfig],
  );

  async function handleLoadFeature(): Promise<void> {
    setIsLoadingFeature(true);
    setLoadError(null);
    setCommitOutcome(null);
    try {
      const snapshot = await loadSourceFeature(featureKeyInput, fieldConfig, new Date().toISOString());
      const scopeKey = deriveSplitScopeKey(snapshot.key);

      // Returning to a Feature resumes the draft already in progress for it rather than starting over.
      const existingDraft = loadSplitDraft(dashboardTeamProfileId, scopeKey);
      const resumedDraft: SplitDraft = {
        ...existingDraft,
        profileId: dashboardTeamProfileId,
        scopeKey,
        sourceFeatureKey: snapshot.key,
        sourceSnapshot: snapshot,
        targetProjectKey: existingDraft.targetProjectKey || snapshot.projectKey,
      };
      updateDraft(resumedDraft);

      // Required fields are keyed by project + issue type, both of which the snapshot now carries.
      const fieldsResponse = await getIssueTypeFields(snapshot.projectKey, snapshot.issueTypeId);
      setRequiredFieldDescriptors(fieldsResponse.values ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load that Feature.');
    } finally {
      setIsLoadingFeature(false);
    }
  }

  function handleAddIncrement(): void {
    updateDraft({
      ...draft,
      increments: [...draft.increments, createEmptyIncrement(mintIncrementId(draft.increments))],
    });
  }

  function handleChangeIncrement(localId: string, patch: Partial<ProposedIncrement>): void {
    updateDraft({
      ...draft,
      increments: draft.increments.map((increment) =>
        increment.localId === localId ? { ...increment, ...patch } : increment,
      ),
    });
  }

  function handleRemoveIncrement(localId: string): void {
    updateDraft({
      ...draft,
      increments: draft.increments.filter((increment) => increment.localId !== localId),
    });
  }

  function handleDiscardDraft(): void {
    discardSplitDraft(dashboardTeamProfileId, draft.scopeKey);
    setDraft(createEmptySplitDraft(dashboardTeamProfileId, deriveSplitScopeKey('')));
    setFeatureKeyInput('');
    setIsReviewing(false);
    setCommitOutcome(null);
    showToast('Split draft discarded.', 'success');
  }

  const commitDiff = useMemo(
    () =>
      buildSplitCommit({
        draft,
        requiredFieldDescriptors,
        availableLinkTypeNames: availableLinkTypeNames.length > 0 ? availableLinkTypeNames : undefined,
      }),
    [draft, requiredFieldDescriptors, availableLinkTypeNames],
  );

  async function handleCommit(): Promise<void> {
    setIsCommitting(true);
    try {
      const outcome = await runSplitCommit(commitDiff);
      setCommitOutcome(outcome);

      // Mark what exists so a retry after a partial failure never creates it twice.
      const committedDraft: SplitDraft = {
        ...draft,
        increments: draft.increments.map((increment) => ({
          ...increment,
          createdJiraKey: outcome.createdKeysByLocalId[increment.localId] ?? increment.createdJiraKey,
        })),
      };

      if (outcome.isFullySuccessful) {
        discardSplitDraft(dashboardTeamProfileId, draft.scopeKey);
        setDraft(committedDraft);
        setIsReviewing(false);
        showToast(`Created ${Object.keys(outcome.createdKeysByLocalId).length} Feature(s).`, 'success');
      } else {
        // Retain the draft: the PO's unfinished work is the whole point of keeping it.
        updateDraft(committedDraft);
        showToast('Some items could not be committed — see the results below.', 'error');
      }
    } finally {
      setIsCommitting(false);
    }
  }

  function renderSourcePanel() {
    if (!draft.sourceSnapshot) {
      return (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>The Feature you are splitting</h3>
          <p className={styles.coachingText}>
            Enter a Feature key above to load it. Its summary, description, and acceptance criteria appear
            here so you can copy from them.
          </p>
        </section>
      );
    }

    const { sourceSnapshot } = draft;
    return (
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>
          {sourceSnapshot.key} · {sourceSnapshot.issueTypeName}
        </h3>
        <div className={styles.sourceFieldBlock}>
          <span className={styles.fieldLabel}>Summary</span>
          <div className={styles.sourceText}>{sourceSnapshot.summary}</div>
        </div>
        <div className={styles.sourceFieldBlock}>
          <span className={styles.fieldLabel}>Description</span>
          <div className={styles.sourceText}>{sourceSnapshot.description || '(none)'}</div>
        </div>
        <div className={styles.sourceFieldBlock}>
          <span className={styles.fieldLabel}>Acceptance criteria</span>
          <div className={styles.sourceText}>{sourceSnapshot.acceptanceCriteria || '(none)'}</div>
        </div>
        <p className={styles.coachingText}>
          New Features will be created as <strong>{sourceSnapshot.issueTypeName}</strong>, the same type as
          the original. {sourceSnapshot.key} itself is never changed or closed by a split.
        </p>
      </section>
    );
  }

  function renderIncrement(increment: ProposedIncrement, incrementIndex: number) {
    const hygieneFlags = increment.summary.trim() === ''
      ? []
      : evaluateDraft(buildIncrementAsIssue(increment, draft, acceptanceCriteriaFieldId));

    return (
      <li
        key={increment.localId}
        className={`${styles.incrementCard} ${increment.isAccepted ? '' : styles.incrementCardPending}`}
      >
        <div className={styles.incrementHeader}>
          <span className={styles.incrementIndex}>Increment {incrementIndex + 1}</span>
          {increment.createdJiraKey ? (
            <span className={styles.createdBadge}>Created as {increment.createdJiraKey}</span>
          ) : (
            <button
              className={styles.dangerButton}
              type="button"
              onClick={() => handleRemoveIncrement(increment.localId)}
            >
              Remove
            </button>
          )}
        </div>

        <label className={styles.fieldLabel} htmlFor={`${increment.localId}-summary`}>
          Summary
        </label>
        <input
          className={styles.textInput}
          id={`${increment.localId}-summary`}
          type="text"
          value={increment.summary}
          disabled={increment.createdJiraKey !== null}
          onChange={(changeEvent) =>
            handleChangeIncrement(increment.localId, { summary: changeEvent.target.value })
          }
        />

        <label className={styles.fieldLabel} htmlFor={`${increment.localId}-description`}>
          Description
        </label>
        <textarea
          className={styles.textArea}
          id={`${increment.localId}-description`}
          value={increment.description}
          disabled={increment.createdJiraKey !== null}
          onChange={(changeEvent) =>
            handleChangeIncrement(increment.localId, { description: changeEvent.target.value })
          }
        />

        <label className={styles.fieldLabel} htmlFor={`${increment.localId}-ac`}>
          Acceptance criteria
        </label>
        <textarea
          className={styles.textArea}
          id={`${increment.localId}-ac`}
          value={increment.acceptanceCriteria}
          disabled={increment.createdJiraKey !== null}
          onChange={(changeEvent) =>
            handleChangeIncrement(increment.localId, { acceptanceCriteria: changeEvent.target.value })
          }
        />

        {hygieneFlags.length > 0 ? (
          <ul className={styles.hygieneList} aria-label={`Hygiene for increment ${incrementIndex + 1}`}>
            {hygieneFlags.map((flag) => (
              <li
                key={flag.checkId}
                className={`${styles.hygieneFlag} ${
                  flag.severity === 'error' ? styles.hygieneFlagError : styles.hygieneFlagWarn
                }`}
              >
                {flag.label}
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  function renderReview() {
    return (
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Review — nothing has been written yet</h3>

        {commitDiff.driftWarnings.map((warning) => (
          <p className={styles.warningBanner} key={warning}>
            {warning}
          </p>
        ))}

        {commitDiff.blockers.length > 0 ? (
          <ul className={styles.reviewList} aria-label="Blockers">
            {commitDiff.blockers.map((blocker) => (
              <li className={styles.outcomeFailed} key={`${blocker.scope}-${blocker.reason}`}>
                {blocker.reason}
              </li>
            ))}
          </ul>
        ) : null}

        <ul className={styles.reviewList} aria-label="Issues to create">
          {commitDiff.creates.map((plannedCreate) => (
            <li key={plannedCreate.localId}>
              Create in <strong>{plannedCreate.projectKey}</strong>: {plannedCreate.summary}
            </li>
          ))}
        </ul>

        <ul className={styles.reviewList} aria-label="Links to create">
          {commitDiff.links.map((plannedLink) => (
            <li key={plannedLink.fromLocalId}>
              Link it to <strong>{plannedLink.toIssueKey}</strong> as &quot;{plannedLink.linkTypeName}&quot;
            </li>
          ))}
        </ul>

        <div className={styles.loadBar}>
          <button className={styles.secondaryButton} type="button" onClick={() => setIsReviewing(false)}>
            Back to editing
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!canCommitSplit(commitDiff) || isCommitting}
            onClick={handleCommit}
          >
            {isCommitting ? 'Creating…' : `Create ${commitDiff.creates.length} Feature(s) in Jira`}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.splitterTab}>
      <div className={styles.loadBar}>
        <div className={styles.loadField}>
          <label className={styles.fieldLabel} htmlFor="splitter-feature-key">
            Feature key
          </label>
          <input
            className={styles.textInput}
            id="splitter-feature-key"
            type="text"
            placeholder="ABC-123"
            value={featureKeyInput}
            onChange={(changeEvent) => setFeatureKeyInput(changeEvent.target.value)}
          />
        </div>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={isLoadingFeature}
          onClick={handleLoadFeature}
        >
          {isLoadingFeature ? 'Loading…' : 'Load Feature'}
        </button>
        {draft.sourceSnapshot ? (
          <button className={styles.dangerButton} type="button" onClick={handleDiscardDraft}>
            Discard draft
          </button>
        ) : null}
      </div>

      {!canPersist ? (
        <p className={styles.warningBanner}>
          This browser is not letting NodeToolbox save drafts, so your work will be lost if you reload or
          close this tab. Finish and commit in one sitting, or copy your text somewhere safe.
        </p>
      ) : null}

      {loadError ? <p className={styles.errorBanner}>{loadError}</p> : null}
      {fieldConfigError ? <p className={styles.warningBanner}>{fieldConfigError}</p> : null}

      {commitOutcome ? (
        <ul className={styles.reviewList} aria-label="Commit results">
          {commitOutcome.items.map((item) => (
            <li
              className={item.status === 'failed' ? styles.outcomeFailed : styles.outcomeCreated}
              key={item.scope}
            >
              {item.status === 'failed'
                ? `Failed — ${item.failureReason}`
                : `${item.status === 'created' ? 'Created' : 'Linked'} ${item.jiraKey}`}
            </li>
          ))}
        </ul>
      ) : null}

      {isReviewing ? (
        renderReview()
      ) : (
        <div className={styles.workspace}>
          {renderSourcePanel()}

          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>Smaller Features</h3>

            {draft.sourceSnapshot ? (
              <div className={styles.loadBar}>
                <div className={styles.loadField}>
                  <label className={styles.fieldLabel} htmlFor="splitter-target-project">
                    Create in project
                  </label>
                  <input
                    className={styles.textInput}
                    id="splitter-target-project"
                    type="text"
                    value={draft.targetProjectKey}
                    onChange={(changeEvent) =>
                      updateDraft({ ...draft, targetProjectKey: changeEvent.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className={styles.loadField}>
                  <label className={styles.fieldLabel} htmlFor="splitter-link-type">
                    Link back as
                  </label>
                  <select
                    className={styles.selectInput}
                    id="splitter-link-type"
                    value={draft.linkTypeName}
                    onChange={(changeEvent) =>
                      updateDraft({ ...draft, linkTypeName: changeEvent.target.value })
                    }
                  >
                    {(availableLinkTypeNames.length > 0
                      ? availableLinkTypeNames
                      : [draft.linkTypeName]
                    ).map((linkTypeName) => (
                      <option key={linkTypeName} value={linkTypeName}>
                        {linkTypeName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            <ul className={styles.incrementList}>{draft.increments.map(renderIncrement)}</ul>

            <div className={styles.loadBar}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={!draft.sourceSnapshot}
                onClick={handleAddIncrement}
              >
                + Add increment
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!draft.sourceSnapshot || draft.increments.length === 0}
                onClick={() => setIsReviewing(true)}
              >
                Review {draft.increments.length} increment(s)
              </button>
            </div>
          </section>
        </div>
      )}

      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>How to break this down</h3>
        <ul className={styles.coachingList}>
          {SPLIT_HEURISTICS.map((heuristic) => (
            <li className={styles.coachingItem} key={heuristic.id}>
              <p className={styles.coachingName}>{heuristic.name}</p>
              <p className={styles.coachingText}>{heuristic.description}</p>
              <p className={styles.coachingText}>
                <strong>For example:</strong> {heuristic.example}
              </p>
              <p className={styles.coachingPrompt}>{heuristic.prompt}</p>
            </li>
          ))}
        </ul>
        <h3 className={styles.panelTitle}>A good increment</h3>
        <ul className={styles.coachingList}>
          {GOOD_INCREMENT_TESTS.map((incrementTest) => (
            <li className={styles.coachingText} key={incrementTest}>
              {incrementTest}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
