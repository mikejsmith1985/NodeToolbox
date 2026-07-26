// ComponentManagerPanel.tsx — Admin Hub tool to bulk manage Jira project components: export a project's
// components, import a list of names into one or more projects (idempotently), and bulk-remove named
// components with an explicit confirm. All Jira work goes through the server proxy via componentManager;
// this file is UI + orchestration only. Deleting a component removes it from issues that reference it, so
// the remove flow is two-step: find matches → confirm the exact count → delete.

import React, { useState } from 'react';

import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import {
  bulkRemoveComponents,
  formatComponentsForExport,
  importComponentsToProjects,
  listProjectComponents,
  matchComponentsByName,
  parseComponentNames,
} from './lib/componentManager.ts';
import type { JiraComponent, ProjectImportResult, RemoveResult } from './lib/componentManager.ts';
import styles from './AdminHubView.module.css';

/** Copies text to the clipboard, ignoring the rare permission failure (the textarea is still selectable). */
function copyToClipboard(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/** Triggers a browser download of the given text as a .txt file. */
function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Reads a message off an unknown thrown value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Admin Hub Jira Component Manager panel. */
export function ComponentManagerPanel(): React.ReactElement {
  // ── Export ──
  const [exportProjectKey, setExportProjectKey] = useState('');
  const [exportedComponents, setExportedComponents] = useState<JiraComponent[] | null>(null);
  const [exportStatus, setExportStatus] = useState('');

  // ── Import ──
  const [importNamesText, setImportNamesText] = useState('');
  const [importTargetsText, setImportTargetsText] = useState('');
  const [importPickerKey, setImportPickerKey] = useState('');
  const [importResults, setImportResults] = useState<ProjectImportResult[] | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // ── Bulk remove ──
  const [removeProjectKey, setRemoveProjectKey] = useState('');
  const [removeNamesText, setRemoveNamesText] = useState('');
  const [removePreview, setRemovePreview] = useState<{ matched: JiraComponent[]; unmatched: string[] } | null>(null);
  const [removeResult, setRemoveResult] = useState<RemoveResult | null>(null);
  const [removeStatus, setRemoveStatus] = useState('');
  const [isRemoving, setIsRemoving] = useState(false);

  const importTargetKeys = parseComponentNames(importTargetsText).map((key) => key.toUpperCase());

  async function handleExport(): Promise<void> {
    if (exportProjectKey === '') {
      setExportStatus('Pick a project to export.');
      return;
    }
    setExportStatus('Loading components…');
    setExportedComponents(null);
    try {
      const components = await listProjectComponents(exportProjectKey);
      setExportedComponents(components);
      setExportStatus(`${components.length} component(s) in ${exportProjectKey}.`);
    } catch (error) {
      setExportStatus(`Could not load components: ${toMessage(error)} (check VPN / Jira connectivity).`);
    }
  }

  function addImportTarget(): void {
    if (importPickerKey !== '' && !importTargetKeys.includes(importPickerKey.toUpperCase())) {
      setImportTargetsText([...importTargetKeys, importPickerKey.toUpperCase()].join('\n'));
    }
  }

  async function handleImport(): Promise<void> {
    const names = parseComponentNames(importNamesText);
    if (names.length === 0 || importTargetKeys.length === 0) {
      setImportStatus('Provide at least one component name and one target project.');
      return;
    }
    setIsImporting(true);
    setImportStatus(`Importing ${names.length} name(s) into ${importTargetKeys.length} project(s)…`);
    setImportResults(null);
    try {
      const results = await importComponentsToProjects(names, importTargetKeys);
      setImportResults(results);
      const created = results.reduce((sum, result) => sum + result.created.length, 0);
      const skipped = results.reduce((sum, result) => sum + result.skipped.length, 0);
      const failed = results.reduce((sum, result) => sum + result.failed.length, 0);
      setImportStatus(`Done — created ${created}, skipped ${skipped} (already existed), failed ${failed}.`);
    } catch (error) {
      setImportStatus(`Import failed: ${toMessage(error)}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleFindRemovals(): Promise<void> {
    const names = parseComponentNames(removeNamesText);
    setRemoveResult(null);
    if (removeProjectKey === '' || names.length === 0) {
      setRemoveStatus('Pick a project and provide names to remove.');
      setRemovePreview(null);
      return;
    }
    setRemoveStatus('Matching names against the project…');
    try {
      const components = await listProjectComponents(removeProjectKey);
      const preview = matchComponentsByName(components, names);
      setRemovePreview(preview);
      setRemoveStatus(`${preview.matched.length} match(es), ${preview.unmatched.length} not found.`);
    } catch (error) {
      setRemoveStatus(`Could not load components: ${toMessage(error)}`);
      setRemovePreview(null);
    }
  }

  async function handleConfirmRemoval(): Promise<void> {
    if (!removePreview || removePreview.matched.length === 0) {
      return;
    }
    setIsRemoving(true);
    setRemoveStatus(`Deleting ${removePreview.matched.length} component(s)…`);
    try {
      const result = await bulkRemoveComponents(removeProjectKey, removePreview.matched.map((component) => component.name));
      setRemoveResult(result);
      setRemovePreview(null);
      setRemoveStatus(`Deleted ${result.deleted.length}, failed ${result.failed.length}.`);
    } catch (error) {
      setRemoveStatus(`Delete failed: ${toMessage(error)}`);
    } finally {
      setIsRemoving(false);
    }
  }

  const exportText = exportedComponents ? formatComponentsForExport(exportedComponents) : '';

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>🧩 Jira Component Manager</h3>
      <p className={styles.panelStatusLine}>
        Bulk import, export, and remove project components (e.g. a list of repos as component values).
      </p>

      <section className={styles.panelSection} aria-label="Export components">
        <h3 className={styles.sectionTitle}>Export</h3>
        <JiraProjectPicker id="component-export-project" label="Project" value={exportProjectKey} onChange={setExportProjectKey} />
        <div className={styles.panelActions}>
          <button type="button" className={styles.actionButton} onClick={handleExport}>Fetch components</button>
        </div>
        <p className={styles.panelStatusLine} role="status">{exportStatus}</p>
        {exportedComponents ? (
          <>
            <textarea aria-label="Exported component names" className={styles.inputField} readOnly rows={8} value={exportText} />
            <div className={styles.panelActions}>
              <button type="button" className={styles.actionButton} onClick={() => copyToClipboard(exportText)}>Copy</button>
              <button type="button" className={styles.actionButton} onClick={() => downloadText(`${exportProjectKey}-components.txt`, exportText)}>Download</button>
            </div>
          </>
        ) : null}
      </section>

      <section className={styles.panelSection} aria-label="Import components">
        <h3 className={styles.sectionTitle}>Import</h3>
        <label className={styles.fieldLabel} htmlFor="component-import-names">Component names (one per line)</label>
        <textarea id="component-import-names" className={styles.inputField} rows={8} value={importNamesText} onChange={(event) => setImportNamesText(event.target.value)} placeholder="repo-one&#10;repo-two&#10;…" />
        <JiraProjectPicker id="component-import-picker" label="Add a target project" value={importPickerKey} onChange={setImportPickerKey} />
        <div className={styles.panelActions}>
          <button type="button" className={styles.actionButton} onClick={addImportTarget}>Add project</button>
        </div>
        <label className={styles.fieldLabel} htmlFor="component-import-targets">Target project keys</label>
        <textarea id="component-import-targets" className={styles.inputField} rows={3} value={importTargetsText} onChange={(event) => setImportTargetsText(event.target.value)} placeholder="ABC&#10;DEF" />
        <div className={styles.panelActions}>
          <button type="button" className={styles.actionButton} onClick={handleImport} disabled={isImporting}>Import into {importTargetKeys.length} project(s)</button>
        </div>
        <p className={styles.panelStatusLine} role="status">{importStatus}</p>
        {importResults ? (
          <ul>
            {importResults.map((result) => (
              <li key={result.projectKey}>
                <strong>{result.projectKey}</strong>: created {result.created.length}, skipped {result.skipped.length}
                {result.failed.length > 0 ? `, failed ${result.failed.length} (${result.failed.map((failure) => failure.name).join(', ')})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={styles.panelSection} aria-label="Bulk remove components">
        <h3 className={styles.sectionTitle}>Bulk remove</h3>
        <p className={styles.panelStatusLine}>⚠️ Deleting a component also removes it from any issues that reference it. This cannot be undone.</p>
        <JiraProjectPicker id="component-remove-project" label="Project" value={removeProjectKey} onChange={setRemoveProjectKey} />
        <label className={styles.fieldLabel} htmlFor="component-remove-names">Component names to remove (one per line)</label>
        <textarea id="component-remove-names" className={styles.inputField} rows={6} value={removeNamesText} onChange={(event) => setRemoveNamesText(event.target.value)} />
        <div className={styles.panelActions}>
          <button type="button" className={styles.actionButton} onClick={handleFindRemovals}>Find matches</button>
        </div>
        <p className={styles.panelStatusLine} role="status">{removeStatus}</p>
        {removePreview && removePreview.matched.length > 0 ? (
          <div className={styles.panelSection}>
            <p className={styles.panelStatusLine}>Will delete {removePreview.matched.length} component(s): {removePreview.matched.map((component) => component.name).join(', ')}</p>
            {removePreview.unmatched.length > 0 ? <p className={styles.panelStatusLine}>Not found (skipped): {removePreview.unmatched.join(', ')}</p> : null}
            <div className={styles.panelActions}>
              <button type="button" className={styles.dangerButton} onClick={handleConfirmRemoval} disabled={isRemoving}>
                Delete {removePreview.matched.length} component(s)
              </button>
            </div>
          </div>
        ) : null}
        {removeResult ? (
          <p className={styles.panelStatusLine}>Deleted {removeResult.deleted.length} component(s){removeResult.failed.length > 0 ? `; ${removeResult.failed.length} failed` : ''}.</p>
        ) : null}
      </section>
    </div>
  );
}
