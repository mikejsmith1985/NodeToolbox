// ReleaseDocumentTab.tsx — The Team Dashboard's Release Doc tab: one Confluence page per unreleased release (GH #395).

import { useCallback, useEffect, useState } from 'react';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import { buildJiraBrowseUrl } from '../../../utils/jiraBrowseUrl.ts';
import styles from '../SprintDashboardView.module.css';
import { DeploymentStepsEditor } from './DeploymentStepsEditor.tsx';
import { readReleaseDocumentParent, writeReleaseDocumentParent } from './releaseDocumentParentStore.ts';
import {
  createReleaseGatherDeps,
  fetchUnreleasedVersions,
  loadReleaseGatherSettings,
  type ReleaseVersionOption,
} from './releaseDocumentJira.ts';
import { gatherRelease, type EpicGroup, type ReleaseItem } from './releaseGather.ts';
import { buildReleasePageStorage, type DeploymentStep } from './releasePageStorage.ts';
import {
  applyNotesToGroups,
  readReleasePage,
  saveReleasePage,
  syncAllReleases,
  type ReleaseSyncResult,
} from './releasePageSync.ts';

interface ReleaseDocumentTabProps {
  projectKey: string;
  teamProfileId: string;
  teamName: string;
}

const NEEDS_DATE_LABEL = 'needs a release date';
const ITEM_HEADERS = ['Key', 'Summary', 'Type', 'Status', 'Assignee', 'Release check', 'Notes'];

/** The Release-select label for one version: its name and the page title it will get. */
function describeVersion(version: ReleaseVersionOption): string {
  return `${version.name} — ${version.pageTitle ?? NEEDS_DATE_LABEL}`;
}

// Plain words for each sync outcome, shown in the per-release report.
const SYNC_OUTCOME_LABELS: Record<ReleaseSyncResult['outcome'], string> = {
  created: 'created',
  updated: 'updated',
  'skipped-empty': 'skipped — no work in this release',
  'skipped-no-date': `skipped — ${NEEDS_DATE_LABEL}`,
  failed: 'failed',
};

/** One report line: which page, and what happened to it. */
function describeSyncResult(result: ReleaseSyncResult): string {
  const outcomeText = SYNC_OUTCOME_LABELS[result.outcome];
  return `${result.pageTitle ?? result.versionName}: ${outcomeText}${result.detail ? ` (${result.detail})` : ''}`;
}

/** Every note currently shown, by issue key — what a Jira refresh must carry over. */
function collectNotes(groups: readonly EpicGroup[]): Map<string, string> {
  const notesByKey = new Map<string, string>();
  groups.forEach((group) => [group.epic, ...group.items].forEach((item) => {
    if (item && item.notes) notesByKey.set(item.key, item.notes);
  }));
  return notesByKey;
}

/** One release-items row with its editable Notes cell. */
function ItemRow({ item, isEpic, releaseCheck, onNotesChange }: {
  item: ReleaseItem;
  isEpic: boolean;
  releaseCheck: string;
  onNotesChange: (issueKey: string, notes: string) => void;
}) {
  const text = (value: string) => (isEpic ? <strong>{value}</strong> : value);
  return (
    <tr>
      <td>{isEpic ? <strong>{item.key}</strong> : `↳ ${item.key}`}</td>
      <td>{text(item.summary)}</td>
      <td>{item.issueTypeName}</td>
      <td>{item.statusName}</td>
      <td>{item.assigneeName}</td>
      <td className={styles.releaseCheckFlag}>{releaseCheck}</td>
      <td>
        <input
          aria-label={`Notes for ${item.key}`}
          className={styles.settingsInput}
          onChange={(changeEvent) => onNotesChange(item.key, changeEvent.target.value)}
          type="text"
          value={item.notes}
        />
      </td>
    </tr>
  );
}

/** The release items: each Epic, its children beneath, "No Epic" last. */
function ReleaseItemsTable({ groups, onNotesChange }: { groups: EpicGroup[]; onNotesChange: (issueKey: string, notes: string) => void }) {
  return (
    <div className={styles.releaseNotesTableShell}>
      <table className={styles.releaseNotesTable}>
        <thead><tr>{ITEM_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {groups.map((group) => {
            const releaseCheck = group.misalignments.map((misalignment) => misalignment.message).join(' ');
            const epicRow = group.epic
              ? <ItemRow isEpic item={group.epic} key={group.epic.key} onNotesChange={onNotesChange} releaseCheck={releaseCheck} />
              : (
                <tr key={`epic-${group.epicKey ?? 'none'}`}>
                  <td colSpan={5}><strong>{group.epicKey ?? 'No Epic'}</strong>{group.epicKey ? ' (Epic not readable)' : ''}</td>
                  <td className={styles.releaseCheckFlag}>{releaseCheck}</td>
                  <td />
                </tr>
              );
            return [epicRow, ...group.items.map((item) => (
              <ItemRow isEpic={false} item={item} key={item.key} onNotesChange={onNotesChange} releaseCheck="" />
            ))];
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pick an unreleased release, pull it from Jira (merged with what is already typed on its page), edit notes
 * and deployment steps, and save the page under the team's parent page.
 */
export function ReleaseDocumentTab({ projectKey, teamProfileId, teamName }: ReleaseDocumentTabProps) {
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? '');
  const [versions, setVersions] = useState<ReleaseVersionOption[]>([]);
  const [parentReference, setParentReference] = useState(() => readReleaseDocumentParent(teamProfileId));
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [groups, setGroups] = useState<EpicGroup[] | null>(null);
  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastSyncedLabel, setLastSyncedLabel] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [syncReport, setSyncReport] = useState<ReleaseSyncResult[]>([]);

  useEffect(() => {
    fetchUnreleasedVersions(projectKey)
      .then(setVersions)
      .catch((loadError: unknown) => setErrorMessage(loadError instanceof Error ? loadError.message : 'Could not load the releases.'));
  }, [projectKey]);

  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;
  const canSave = groups !== null && selectedVersion?.pageTitle != null && parentReference.trim() !== '' && !isBusy;

  const handleParentChange = (nextReference: string) => {
    setParentReference(nextReference);
    writeReleaseDocumentParent(teamProfileId, nextReference);
  };

  const handleVersionChange = (nextVersionId: string) => {
    setSelectedVersionId(nextVersionId);
    setGroups(null);
    setDeploymentSteps([]);
    setPageUrl('');
    setHasUnsavedChanges(false);
    setStatusMessage('');
  };

  const handlePull = useCallback(async () => {
    if (!selectedVersion) return;
    setIsBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const settings = loadReleaseGatherSettings(teamProfileId);
      const [gathered, existingPage] = await Promise.all([
        gatherRelease({ ...settings, teamProjectKey: projectKey, versionName: selectedVersion.name }, createReleaseGatherDeps(settings.featureLinkField)),
        parentReference.trim() && selectedVersion.pageTitle
          ? readReleasePage({ parentPageReference: parentReference, title: selectedVersion.pageTitle })
          : Promise.resolve(null),
      ]);
      // Notes typed here since the last pull win; otherwise the page's notes and steps are brought in.
      const notesByKey = groups !== null ? collectNotes(groups) : existingPage?.parsed.notesByKey ?? new Map<string, string>();
      setGroups(applyNotesToGroups(gathered.groups, notesByKey));
      if (groups === null) setDeploymentSteps(existingPage?.parsed.deploymentSteps ?? []);
      setWarnings(gathered.warnings);
      setPageUrl(existingPage?.pageUrl ?? '');
      setLastSyncedLabel(new Date().toLocaleString());
    } catch (pullError) {
      setErrorMessage(pullError instanceof Error ? pullError.message : 'Could not pull the release from Jira.');
    } finally {
      setIsBusy(false);
    }
  }, [selectedVersion, teamProfileId, projectKey, parentReference, groups]);

  const handleSave = useCallback(async () => {
    if (!groups || !selectedVersion?.pageTitle) return;
    setIsBusy(true);
    setErrorMessage('');
    try {
      const document = { groups, deploymentSteps, lastSyncedLabel: lastSyncedLabel || new Date().toLocaleString() };
      const outcome = await saveReleasePage({
        parentPageReference: parentReference,
        title: selectedVersion.pageTitle,
        buildStorage: () => buildReleasePageStorage(document, (issueKey) => buildJiraBrowseUrl(issueKey, jiraBaseUrl)),
      });
      setPageUrl(outcome.pageUrl);
      setHasUnsavedChanges(false);
      setStatusMessage(outcome.wasCreated ? `Created ${selectedVersion.pageTitle} in Confluence.` : `Updated ${selectedVersion.pageTitle} in Confluence.`);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : 'Could not save the release page.');
    } finally {
      setIsBusy(false);
    }
  }, [groups, deploymentSteps, lastSyncedLabel, parentReference, selectedVersion, jiraBaseUrl]);

  const handleSyncAll = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage('');
    setSyncReport([]);
    try {
      const settings = loadReleaseGatherSettings(teamProfileId);
      const gatherDeps = createReleaseGatherDeps(settings.featureLinkField);
      const report = await syncAllReleases({
        versions,
        parentPageReference: parentReference,
        gatherVersion: (versionName) => gatherRelease({ ...settings, teamProjectKey: projectKey, versionName }, gatherDeps),
        buildIssueUrl: (issueKey) => buildJiraBrowseUrl(issueKey, jiraBaseUrl),
        lastSyncedLabel: new Date().toLocaleString(),
      });
      setSyncReport(report);
    } catch (syncError) {
      setErrorMessage(syncError instanceof Error ? syncError.message : 'Could not sync the releases.');
    } finally {
      setIsBusy(false);
    }
  }, [versions, parentReference, teamProfileId, projectKey, jiraBaseUrl]);

  const handleNotesChange = (issueKey: string, notes: string) => {
    setGroups((currentGroups) => (currentGroups ? applyNotesToGroups(currentGroups, new Map([[issueKey, notes]])) : currentGroups));
    setHasUnsavedChanges(true);
  };

  const handleStepsChange = (nextSteps: DeploymentStep[]) => {
    setDeploymentSteps(nextSteps);
    setHasUnsavedChanges(true);
  };

  return (
    <section className={`${styles.settingsSectionCard} ${styles.releaseDocumentPanel}`}>
      <h2 className={styles.settingsSectionTitle}>{`Release Doc${teamName ? ` — ${teamName}` : ''}`}</h2>
      <p className={styles.issueMetaText}>
        One Confluence page per unreleased release: every Epic with its children in the release, and the deployment steps.
        Pull from Jira any time — your notes and deployment steps are kept.
      </p>
      <div className={styles.releaseDocumentToolbar}>
        <input
          aria-label="Release document parent page"
          className={styles.settingsInput}
          onChange={(changeEvent) => handleParentChange(changeEvent.target.value)}
          placeholder="Confluence parent page URL — each release is a page beneath it"
          type="text"
          value={parentReference}
        />
        <label className={styles.rosterCapacityField} htmlFor="release-document-version">
          <span className={styles.rosterRoleLegend}>Release</span>
        </label>
        <select
          aria-label="Release"
          className={styles.settingsInput}
          id="release-document-version"
          onChange={(changeEvent) => handleVersionChange(changeEvent.target.value)}
          value={selectedVersionId}
        >
          <option value="">— Select a release —</option>
          {versions.map((version) => <option key={version.id} value={version.id}>{describeVersion(version)}</option>)}
        </select>
        <button className={styles.secondaryButton} disabled={!selectedVersion || isBusy} onClick={() => void handlePull()} type="button">
          ↻ Pull from Jira
        </button>
        <button className={styles.secondaryButton} disabled={!canSave} onClick={() => void handleSave()} type="button">
          📤 Save to Confluence
        </button>
        <button
          className={styles.secondaryButton}
          disabled={versions.length === 0 || parentReference.trim() === '' || isBusy}
          onClick={() => void handleSyncAll()}
          title="Bring every unreleased release's page up to date; items that changed release move with their notes"
          type="button"
        >
          ⇅ Sync all releases
        </button>
        {hasUnsavedChanges ? <span className={styles.releaseCheckFlag}>Unsaved changes</span> : null}
        {pageUrl ? <a href={pageUrl} rel="noreferrer" target="_blank">Open page ↗</a> : null}
      </div>
      {errorMessage ? <p className={styles.errorMessage}>{errorMessage}</p> : null}
      {statusMessage ? <p className={styles.releaseNotesCopyConfirmation}>{statusMessage}</p> : null}
      {syncReport.length > 0 ? (
        <ul className={styles.issueMetaText}>
          {syncReport.map((result) => <li key={result.versionName}>{describeSyncResult(result)}</li>)}
        </ul>
      ) : null}
      {warnings.map((warning) => <p className={styles.issueMetaText} key={warning}>{warning}</p>)}
      {groups !== null ? (
        <>
          <p className={styles.issueMetaText}>{`Last synced from Jira: ${lastSyncedLabel}`}</p>
          <ReleaseItemsTable groups={groups} onNotesChange={handleNotesChange} />
          <h3 className={styles.settingsSectionTitle}>Deployment Steps</h3>
          <DeploymentStepsEditor onChange={handleStepsChange} steps={deploymentSteps} />
        </>
      ) : null}
    </section>
  );
}
