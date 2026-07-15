// FeatureCompositionTab.tsx — Write a Feature without leaving the tool.
//
// A PO composing a Feature normally has a Confluence brief, a spreadsheet of volumes, two related
// tickets and a Teams thread open in other windows. Pulling them into ONE workspace beside the draft is
// most of the value here — before any AI is involved.
//
// The other half is that hygiene stops being an audit: the live checklist grades the draft as it is
// typed, against the same rules the Hygiene tool applies. Two different gates share this screen and must
// never be confused: hygiene is ADVISORY (it never blocks), while Jira's own required fields are a HARD
// block on create.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '../../components/Toast/ToastContext.ts';
import { getIssueTypeFields, getProjectIssueTypes, jiraGet } from '../../services/jiraApi.ts';
import type { CreateMetaFieldEntry, CreateMetaIssueType } from '../../types/jira.ts';
import { saveFeatureReviewSimpleField } from '../SprintDashboard/featureReviewFixes.ts';
import type { JiraIssue as HygieneIssue } from '../Hygiene/checks/hygieneChecks';
import { DEFINITION_OF_READY, FEATURE_WRITING_TIPS } from './coaching/definitionOfReady';
import {
  createEmptyCompositionDraft,
  type CompositionDraft,
} from './drafts/draftModel';
import {
  deriveCompositionScopeKeyForIssue,
  deriveCompositionScopeKeyForNew,
  discardCompositionDraft,
  loadCompositionDraft,
  saveCompositionDraft,
} from './drafts/compositionDraftStorage';
import { canPersistDrafts } from './drafts/splitDraftStorage';
import { usePoHygieneContext } from './hooks/usePoHygieneContext';
import { buildCompositionCommit, canCommitComposition } from './jira/buildCompositionCommit';
import { runCompositionCommit } from './jira/runCommit';
import type { CommitOutcome } from './jira/runCommit';
import { ConfluenceSourceError, readConfluenceSource } from './sources/confluenceSource';
import {
  describeSourceOrigin,
  describeSourceTitle,
  mintSourceId,
  readSourceText,
  type ReferencedSource,
} from './sources/sourceModel';
import { readWorkbookSource, WORKBOOK_FILE_ACCEPT, WorkbookReadError } from './sources/workbookSource';
import styles from './FeatureCompositionTab.module.css';

interface FeatureCompositionTabProps {
  /** The PO Tool's own team profile — scopes drafts and the hygiene rules applied. */
  dashboardTeamProfileId: string;
  /** Seeds the target project so a PO usually does not have to pick one. */
  defaultProjectKey: string;
}

/** Mints an id for a from-scratch composition so it gets a draft of its own, not a shared one. */
function mintNewCompositionId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export default function FeatureCompositionTab({
  dashboardTeamProfileId,
  defaultProjectKey,
}: FeatureCompositionTabProps) {
  const { showToast } = useToast();
  const { evaluateDraft, fieldConfig, fieldConfigError } = usePoHygieneContext(dashboardTeamProfileId);

  const [newCompositionId] = useState(mintNewCompositionId);
  // Seeded at first render rather than by an effect: the team's project is known immediately, and the
  // shell remounts this tab when the team changes, so there is nothing to synchronise later.
  const [draft, setDraft] = useState<CompositionDraft>(() => ({
    ...createEmptyCompositionDraft(dashboardTeamProfileId, deriveCompositionScopeKeyForNew(newCompositionId)),
    targetProjectKey: defaultProjectKey || null,
  }));
  const [issueTypeOptions, setIssueTypeOptions] = useState<CreateMetaIssueType[]>([]);
  const [requiredFieldDescriptors, setRequiredFieldDescriptors] = useState<CreateMetaFieldEntry[]>([]);
  const [existingFieldValues, setExistingFieldValues] = useState<Record<string, unknown>>({});
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [confluenceUrlInput, setConfluenceUrlInput] = useState('');
  const [jiraKeyInput, setJiraKeyInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [pasteLabelInput, setPasteLabelInput] = useState('');
  const [loadKeyInput, setLoadKeyInput] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitOutcome, setCommitOutcome] = useState<CommitOutcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [canPersist] = useState(canPersistDrafts);

  const acceptanceCriteriaFieldId = useMemo(
    () => fieldConfig.acceptanceCriteriaFieldIds.find((fieldId) => fieldId !== 'description') ?? null,
    [fieldConfig],
  );

  const updateDraft = useCallback((nextDraft: CompositionDraft) => {
    const stampedDraft = { ...nextDraft, updatedAtIso: new Date().toISOString() };
    setDraft(stampedDraft);
    saveCompositionDraft(stampedDraft);
  }, []);

  // Only the types this project actually offers are ever presented (FR-037).
  useEffect(() => {
    const projectKey = draft.targetProjectKey?.trim();
    if (!projectKey || draft.existingIssueKey !== null) {
      return;
    }
    let isActive = true;
    getProjectIssueTypes(projectKey)
      .then((response) => {
        if (isActive) {
          setIssueTypeOptions(response.values ?? []);
        }
      })
      .catch(() => {
        if (isActive) {
          setIssueTypeOptions([]);
        }
      });
    return () => {
      isActive = false;
    };
  }, [draft.targetProjectKey, draft.existingIssueKey]);

  // Required fields are keyed by project + type, so they are re-read whenever either changes.
  useEffect(() => {
    const projectKey = draft.targetProjectKey?.trim();
    const issueTypeId = draft.targetIssueTypeId?.trim();
    if (!projectKey || !issueTypeId) {
      return;
    }
    let isActive = true;
    getIssueTypeFields(projectKey, issueTypeId)
      .then((response) => {
        if (isActive) {
          setRequiredFieldDescriptors(response.values ?? []);
        }
      })
      .catch(() => {
        if (isActive) {
          setRequiredFieldDescriptors([]);
        }
      });
    return () => {
      isActive = false;
    };
  }, [draft.targetProjectKey, draft.targetIssueTypeId]);

  function addSource(source: ReferencedSource): void {
    updateDraft({ ...draft, sources: [...draft.sources, source] });
    setSourceError(null);
  }

  async function handleAddWorkbook(file: File): Promise<void> {
    try {
      addSource(await readWorkbookSource(file, draft.sources));
    } catch (error) {
      // A bad file costs the PO nothing: the draft is untouched and the message is plain.
      setSourceError(
        error instanceof WorkbookReadError ? error.message : 'That file could not be added.',
      );
    }
  }

  async function handleAddConfluencePage(): Promise<void> {
    try {
      addSource(await readConfluenceSource(confluenceUrlInput, draft.sources, new Date().toISOString()));
      setConfluenceUrlInput('');
    } catch (error) {
      // The message already says WHICH failure this was — missing, forbidden, unreachable, unconfigured.
      setSourceError(
        error instanceof ConfluenceSourceError ? error.message : 'That page could not be added.',
      );
    }
  }

  async function handleAddJiraIssue(): Promise<void> {
    const issueKey = jiraKeyInput.trim().toUpperCase();
    if (issueKey === '') {
      return;
    }
    try {
      const issue = await jiraGet<{ key: string; fields: { summary?: string; status?: { name?: string } } }>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=summary,status`,
      );
      addSource({
        kind: 'jira',
        id: mintSourceId(draft.sources, 'jira'),
        issueKey: issue.key,
        summary: issue.fields.summary ?? '',
        status: issue.fields.status?.name ?? '',
      });
      setJiraKeyInput('');
    } catch (error) {
      setSourceError(
        error instanceof Error ? `Could not add ${issueKey}: ${error.message}` : `Could not add ${issueKey}.`,
      );
    }
  }

  function handleAddPaste(): void {
    if (pasteInput.trim() === '') {
      return;
    }
    addSource({
      kind: 'paste',
      id: mintSourceId(draft.sources, 'paste'),
      label: pasteLabelInput.trim() || 'Pasted note',
      text: pasteInput,
    });
    setPasteInput('');
    setPasteLabelInput('');
  }

  function handleRemoveSource(sourceId: string): void {
    updateDraft({ ...draft, sources: draft.sources.filter((source) => source.id !== sourceId) });
  }

  /** Loads an existing Feature so this composition enriches it instead of creating a duplicate. */
  async function handleLoadExistingFeature(): Promise<void> {
    const issueKey = loadKeyInput.trim().toUpperCase();
    if (issueKey === '') {
      return;
    }
    try {
      const requestedFields = ['summary', 'description', ...(acceptanceCriteriaFieldId ? [acceptanceCriteriaFieldId] : [])];
      const issue = await jiraGet<{ key: string; fields: Record<string, unknown> }>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(requestedFields.join(','))}`,
      );
      const scopeKey = deriveCompositionScopeKeyForIssue(issue.key);
      const existingDraft = loadCompositionDraft(dashboardTeamProfileId, scopeKey);

      setExistingFieldValues(issue.fields);
      updateDraft({
        ...existingDraft,
        profileId: dashboardTeamProfileId,
        scopeKey,
        existingIssueKey: issue.key,
        summary: existingDraft.summary || String(issue.fields.summary ?? ''),
        description: existingDraft.description || String(issue.fields.description ?? ''),
        acceptanceCriteria: existingDraft.acceptanceCriteria
          || (acceptanceCriteriaFieldId ? String(issue.fields[acceptanceCriteriaFieldId] ?? '') : ''),
      });
      setLoadKeyInput('');
      setSourceError(null);
    } catch (error) {
      setSourceError(
        error instanceof Error ? `Could not load ${issueKey}: ${error.message}` : `Could not load ${issueKey}.`,
      );
    }
  }

  function handleDiscardDraft(): void {
    discardCompositionDraft(dashboardTeamProfileId, draft.scopeKey);
    setDraft(createEmptyCompositionDraft(dashboardTeamProfileId, deriveCompositionScopeKeyForNew(newCompositionId)));
    setExistingFieldValues({});
    setCommitOutcome(null);
    showToast('Composition draft discarded.', 'success');
  }

  /** The draft graded by the same rules the Hygiene tool uses — advisory, never a block (FR-029). */
  const hygieneFlags = useMemo(() => {
    if (draft.summary.trim() === '' && draft.description.trim() === '') {
      return [];
    }
    const draftAsIssue: HygieneIssue = {
      key: draft.existingIssueKey ?? 'DRAFT',
      fields: {
        summary: draft.summary,
        description: draft.description,
        issuetype: { name: 'Feature' },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        ...(acceptanceCriteriaFieldId ? { [acceptanceCriteriaFieldId]: draft.acceptanceCriteria } : {}),
        ...draft.fields,
      },
    } as HygieneIssue;
    return evaluateDraft(draftAsIssue);
  }, [draft, acceptanceCriteriaFieldId, evaluateDraft]);

  const commitDiff = useMemo(
    () =>
      buildCompositionCommit({
        draft,
        requiredFieldDescriptors,
        acceptanceCriteriaFieldId,
        existingFieldValues,
      }),
    [draft, requiredFieldDescriptors, acceptanceCriteriaFieldId, existingFieldValues],
  );

  async function handleCommit(): Promise<void> {
    setIsCommitting(true);
    try {
      const outcome = await runCompositionCommit(commitDiff, {
        createIssue: (await import('../../services/jiraApi.ts')).createIssue,
        saveField: (issueKey, fieldId, value) =>
          saveFeatureReviewSimpleField(issueKey, fieldId, String(value ?? '')),
      });
      setCommitOutcome(outcome);

      if (outcome.isFullySuccessful) {
        discardCompositionDraft(dashboardTeamProfileId, draft.scopeKey);
        const createdKey = outcome.createdKeysByLocalId.feature;
        showToast(createdKey ? `Created ${createdKey}.` : `Saved ${draft.existingIssueKey}.`, 'success');
      } else {
        showToast('Some changes could not be saved — see the results below.', 'error');
      }
    } finally {
      setIsCommitting(false);
    }
  }

  const isUpdatingExisting = draft.existingIssueKey !== null;

  return (
    <div className={styles.compositionTab}>
      <div className={styles.loadBar}>
        <div className={styles.loadField}>
          <label className={styles.fieldLabel} htmlFor="composition-load-key">
            Enrich an existing Feature (optional)
          </label>
          <input
            className={styles.textInput}
            id="composition-load-key"
            type="text"
            placeholder="ABC-123"
            value={loadKeyInput}
            onChange={(changeEvent) => setLoadKeyInput(changeEvent.target.value)}
          />
        </div>
        <button className={styles.secondaryButton} type="button" onClick={handleLoadExistingFeature}>
          Load
        </button>
        <button className={styles.dangerButton} type="button" onClick={handleDiscardDraft}>
          Discard draft
        </button>
      </div>

      {isUpdatingExisting ? (
        <p className={styles.infoBanner}>
          Editing <strong>{draft.existingIssueKey}</strong>. Saving updates that Feature — it will not create
          a second one.
        </p>
      ) : (
        <p className={styles.infoBanner}>
          Writing a new Feature. Nothing exists in Jira until you choose a project and create it.
        </p>
      )}

      {!canPersist ? (
        <p className={styles.warningBanner}>
          This browser is not letting NodeToolbox save drafts, so your work will be lost if you reload or
          close this tab. Finish in one sitting, or copy your text somewhere safe.
        </p>
      ) : null}

      {sourceError ? <p className={styles.errorBanner}>{sourceError}</p> : null}
      {fieldConfigError ? <p className={styles.warningBanner}>{fieldConfigError}</p> : null}

      <div className={styles.workspace}>
        {/* ── Sources ── */}
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>What you are writing from</h3>

          <div
            className={`${styles.dropzone} ${isDragActive ? styles.dropzoneActive : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Add a spreadsheet"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(dragEvent) => {
              dragEvent.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(dropEvent) => {
              dropEvent.preventDefault();
              setIsDragActive(false);
              const droppedFile = dropEvent.dataTransfer.files?.[0];
              if (droppedFile) {
                void handleAddWorkbook(droppedFile);
              }
            }}
          >
            Drop a spreadsheet here, or click to choose one (.xlsx, .xls, .csv)
          </div>
          <input
            accept={WORKBOOK_FILE_ACCEPT}
            className={styles.hiddenInput}
            ref={fileInputRef}
            type="file"
            aria-label="Spreadsheet file"
            onChange={(changeEvent) => {
              const pickedFile = changeEvent.target.files?.[0];
              if (pickedFile) {
                void handleAddWorkbook(pickedFile);
              }
              changeEvent.target.value = '';
            }}
          />

          <div className={styles.loadBar}>
            <div className={styles.loadFieldWide}>
              <label className={styles.fieldLabel} htmlFor="composition-confluence-url">
                Confluence page URL
              </label>
              <input
                className={styles.textInput}
                id="composition-confluence-url"
                type="text"
                placeholder="https://…/pages/12345/Brief"
                value={confluenceUrlInput}
                onChange={(changeEvent) => setConfluenceUrlInput(changeEvent.target.value)}
              />
            </div>
            <button className={styles.secondaryButton} type="button" onClick={handleAddConfluencePage}>
              Add page
            </button>
          </div>

          <div className={styles.loadBar}>
            <div className={styles.loadField}>
              <label className={styles.fieldLabel} htmlFor="composition-jira-key">
                Related Jira issue
              </label>
              <input
                className={styles.textInput}
                id="composition-jira-key"
                type="text"
                placeholder="ABC-9"
                value={jiraKeyInput}
                onChange={(changeEvent) => setJiraKeyInput(changeEvent.target.value)}
              />
            </div>
            <button className={styles.secondaryButton} type="button" onClick={handleAddJiraIssue}>
              Add issue
            </button>
          </div>

          <div className={styles.loadField}>
            <label className={styles.fieldLabel} htmlFor="composition-paste-label">
              Paste anything else
            </label>
            <input
              className={styles.textInput}
              id="composition-paste-label"
              type="text"
              placeholder="What is it? e.g. Teams thread with Jana"
              value={pasteLabelInput}
              onChange={(changeEvent) => setPasteLabelInput(changeEvent.target.value)}
            />
            <textarea
              className={styles.textArea}
              aria-label="Pasted content"
              value={pasteInput}
              onChange={(changeEvent) => setPasteInput(changeEvent.target.value)}
            />
            <button className={styles.secondaryButton} type="button" onClick={handleAddPaste}>
              Add note
            </button>
          </div>

          <ul className={styles.sourceList} aria-label="Referenced sources">
            {draft.sources.map((source) => (
              <li className={styles.sourceCard} key={source.id}>
                <div className={styles.sourceHeader}>
                  <strong className={styles.sourceTitle}>{describeSourceTitle(source)}</strong>
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={() => handleRemoveSource(source.id)}
                  >
                    Remove
                  </button>
                </div>
                {/* Every source says where it came from — FR-024. */}
                <p className={styles.sourceOrigin}>{describeSourceOrigin(source)}</p>
                <div className={styles.sourceText}>{readSourceText(source)}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── The draft ── */}
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>The Feature</h3>

          <label className={styles.fieldLabel} htmlFor="composition-summary">
            Summary
          </label>
          <input
            className={styles.textInput}
            id="composition-summary"
            type="text"
            value={draft.summary}
            onChange={(changeEvent) => updateDraft({ ...draft, summary: changeEvent.target.value })}
          />

          <label className={styles.fieldLabel} htmlFor="composition-description">
            Description
          </label>
          <textarea
            className={styles.textAreaTall}
            id="composition-description"
            value={draft.description}
            onChange={(changeEvent) => updateDraft({ ...draft, description: changeEvent.target.value })}
          />

          <label className={styles.fieldLabel} htmlFor="composition-ac">
            Acceptance criteria
          </label>
          <textarea
            className={styles.textArea}
            id="composition-ac"
            value={draft.acceptanceCriteria}
            onChange={(changeEvent) => updateDraft({ ...draft, acceptanceCriteria: changeEvent.target.value })}
          />

          <label className={styles.fieldLabel} htmlFor="composition-narrative">
            Your own words about this Feature
          </label>
          <textarea
            className={styles.textArea}
            id="composition-narrative"
            placeholder="Explain it as you would to a colleague. Kept with the draft."
            value={draft.poNarrative}
            onChange={(changeEvent) => updateDraft({ ...draft, poNarrative: changeEvent.target.value })}
          />

          {!isUpdatingExisting ? (
            <div className={styles.loadBar}>
              <div className={styles.loadField}>
                <label className={styles.fieldLabel} htmlFor="composition-project">
                  Create in project
                </label>
                <input
                  className={styles.textInput}
                  id="composition-project"
                  type="text"
                  value={draft.targetProjectKey ?? ''}
                  onChange={(changeEvent) =>
                    updateDraft({ ...draft, targetProjectKey: changeEvent.target.value.toUpperCase() })
                  }
                />
              </div>
              <div className={styles.loadField}>
                <label className={styles.fieldLabel} htmlFor="composition-issue-type">
                  Issue type
                </label>
                <select
                  className={styles.selectInput}
                  id="composition-issue-type"
                  value={draft.targetIssueTypeId ?? ''}
                  onChange={(changeEvent) =>
                    updateDraft({ ...draft, targetIssueTypeId: changeEvent.target.value || null })
                  }
                >
                  <option value="">Choose…</option>
                  {issueTypeOptions.map((issueType) => (
                    <option key={issueType.id} value={issueType.id}>
                      {issueType.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {/* Advisory. Never blocks a commit — FR-029. */}
          <h4 className={styles.panelSubtitle}>Readiness checklist</h4>
          {hygieneFlags.length === 0 ? (
            <p className={styles.checklistClean}>Nothing outstanding against your team&apos;s rules.</p>
          ) : (
            <ul className={styles.hygieneList} aria-label="Readiness checklist">
              {hygieneFlags.map((flag) => (
                <li
                  className={`${styles.hygieneFlag} ${
                    flag.severity === 'error' ? styles.hygieneFlagError : styles.hygieneFlagWarn
                  }`}
                  key={flag.checkId}
                >
                  {flag.label}
                </li>
              ))}
            </ul>
          )}

          {/* A hard block, unlike the checklist above — FR-034. */}
          {commitDiff.blockers.length > 0 ? (
            <ul className={styles.reviewList} aria-label="Blockers">
              {commitDiff.blockers.map((blocker) => (
                <li className={styles.outcomeFailed} key={blocker.reason}>
                  {blocker.reason}
                </li>
              ))}
            </ul>
          ) : null}

          {commitDiff.update && commitDiff.update.changedFields.length > 0 ? (
            <ul className={styles.reviewList} aria-label="Changes to save">
              {commitDiff.update.changedFields.map((changedField) => (
                <li key={changedField.fieldId}>Update {changedField.label}</li>
              ))}
            </ul>
          ) : null}

          <button
            className={styles.primaryButton}
            type="button"
            disabled={!canCommitComposition(commitDiff) || isCommitting}
            onClick={handleCommit}
          >
            {isCommitting
              ? 'Saving…'
              : isUpdatingExisting
                ? `Save changes to ${draft.existingIssueKey}`
                : 'Create Feature in Jira'}
          </button>

          {commitOutcome ? (
            <ul className={styles.reviewList} aria-label="Commit results">
              {commitOutcome.items.map((item) => (
                <li
                  className={item.status === 'failed' ? styles.outcomeFailed : styles.outcomeCreated}
                  key={item.scope}
                >
                  {item.status === 'failed' ? `Failed — ${item.failureReason}` : `${item.status} ${item.jiraKey}`}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>What &quot;ready&quot; looks like</h3>
        <ul className={styles.coachingList}>
          {DEFINITION_OF_READY.map((criterion) => (
            <li className={styles.coachingItem} key={criterion.id}>
              <p className={styles.coachingName}>{criterion.name}</p>
              <p className={styles.coachingText}>{criterion.description}</p>
              <p className={styles.coachingPrompt}>{criterion.prompt}</p>
            </li>
          ))}
        </ul>
        <h3 className={styles.panelTitle}>Writing it well</h3>
        <ul className={styles.coachingList}>
          {FEATURE_WRITING_TIPS.map((tip) => (
            <li className={styles.coachingText} key={tip}>
              {tip}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
