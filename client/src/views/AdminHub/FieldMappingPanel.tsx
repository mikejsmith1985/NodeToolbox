// FieldMappingPanel.tsx — The five Jira fields this app reasons with, and which one it actually chose.
//
// Each of them resolves the same way: a saved choice, then a field discovered by NAME, then a
// hard-coded default. The chain was sound and completely invisible — nothing on any screen said which
// field had been picked, and the last step is the one that bites. On a different Jira, discovery misses
// and the default reads whatever happens to hold that id, so the app carries on confidently, attached
// to the wrong data, reporting nothing.
//
// This is the screen that makes a re-point survivable: read the field list once, show what resolved to
// what, and let somebody choose from a list rather than type an id they would have to go and look up.

import { useCallback, useEffect, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import {
  describeMappingHealth,
  readFieldMappingOverrides,
  resolveAllFieldMappings,
  writeFieldMappingOverride,
  type FieldMappingResolution,
} from '../../services/jiraFieldMapping.ts';
import type { JiraField } from '../../types/jira.ts';
import styles from './AdminHubView.module.css';

/** How each resolution is described, in the reader's terms rather than the code's. */
const SOURCE_LABELS: Record<FieldMappingResolution['source'], string> = {
  chosen: 'chosen here',
  discovered: 'found by name',
  'hard-default': 'built-in default — unconfirmed',
  missing: 'NOT WORKING',
};

/** Shows which field drives what, and lets somebody put it right. */
export function FieldMappingPanel(): React.JSX.Element {
  const [availableFields, setAvailableFields] = useState<JiraField[]>([]);
  const [resolutions, setResolutions] = useState<FieldMappingResolution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  /** Re-resolves from whatever is currently saved. Cheap, so it runs after every change. */
  const refreshResolutions = useCallback((fields: readonly JiraField[]): void => {
    setResolutions(resolveAllFieldMappings(fields, readFieldMappingOverrides(window.localStorage)));
  }, []);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    void (async () => {
      try {
        const fields = await jiraGet<JiraField[]>('/rest/api/2/field');
        if (!isCurrent) return;
        setAvailableFields(fields ?? []);
        refreshResolutions(fields ?? []);
      } catch (fieldError: unknown) {
        if (isCurrent) setErrorMessage(`Could not read this Jira's field list: ${String(fieldError)}`);
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    })();
    return () => { isCurrent = false; };
  }, [refreshResolutions]);

  function handleChoose(resolution: FieldMappingResolution, nextFieldId: string): void {
    writeFieldMappingOverride(window.localStorage, resolution.entry.settingsKey, nextFieldId);
    refreshResolutions(availableFields);
  }

  return (
    <div className={styles.panelCard} data-testid="field-mapping-panel">
      <h3 className={styles.sectionTitle}>Jira field mapping</h3>
      <p className={styles.fieldLabel}>
        These five custom fields drive most of what this app works out. Field ids differ between Jira
        instances, so each is found by NAME — and where the name finds nothing, a built-in default is
        read instead, which on a different Jira may belong to something else entirely. Anything below
        that is not simply <strong>found by name</strong> is worth a look.
      </p>

      {isLoading && <p className={styles.panelStatusLine}>Reading this Jira&apos;s field list…</p>}
      {errorMessage !== '' && <p className={styles.panelStatusLine}>{errorMessage}</p>}

      {resolutions.length > 0 && (
        <p className={styles.panelStatusLine}>{describeMappingHealth(resolutions)}</p>
      )}

      {resolutions.map((resolution) => (
        <div className={styles.panelSection} key={resolution.entry.settingsKey}>
          <span className={styles.fieldLabel}>
            <strong>{resolution.entry.label}</strong>
            {resolution.entry.importance === 'critical' && ' · critical'}
            {' — drives '}{resolution.entry.whatItDrives}.
          </span>

          <label className={styles.fieldLabel}>
            Field
            <select
              aria-label={`${resolution.entry.label} field`}
              className={styles.inputField}
              disabled={availableFields.length === 0}
              onChange={(changeEvent) => handleChoose(resolution, changeEvent.target.value)}
              value={resolution.chosenFieldId ?? ''}
            >
              {/* Not choosing is a real answer, and the default one: it means "keep finding it by
                  name", which stays correct if the instance renames an id but keeps the name. */}
              <option value="">
                Find it by name (currently {resolution.effectiveFieldId} — {SOURCE_LABELS[resolution.source]})
              </option>
              {availableFields.map((field) => (
                <option key={String(field.id)} value={String(field.id)}>
                  {String(field.name)} — {String(field.id)}
                </option>
              ))}
            </select>
          </label>

          {/* The warning sits under the control that fixes it, not in a list somewhere else. */}
          {resolution.riskNote !== null && (
            <span className={styles.panelStatusLine}>{resolution.riskNote}</span>
          )}
        </div>
      ))}
    </div>
  );
}
