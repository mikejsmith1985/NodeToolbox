// LaunchDialog.tsx — Creates a Jira issue from a saved template in one confirmed action.
// Prompts only for fields marked prompt-at-launch (pre-filled with any default); fixed values
// are applied automatically. Validates required fields before creating and shows the new issue's
// link on success.

import { useMemo } from 'react';

import { useTemplateLaunch } from '../hooks/useTemplateLaunch.ts';
import type { FieldDescriptor, JiraTemplate } from '../lib/templateTypes.ts';
import styles from '../JiraTemplateMaker.module.css';
import FieldValueInput from './FieldValueInput.tsx';

interface LaunchDialogProps {
  template: JiraTemplate;
  descriptors: FieldDescriptor[];
  onClose: () => void;
}

const REPORTER_FIELD_ID = 'reporter';

/** Modal-style panel that walks the user through creating an issue from one template. */
export default function LaunchDialog({ template, descriptors, onClose }: LaunchDialogProps) {
  const launch = useTemplateLaunch();
  const descriptorById = useMemo(
    () => new Map(descriptors.map((descriptor) => [descriptor.fieldId, descriptor])),
    [descriptors],
  );

  const promptFields = template.fields.filter((entry) => entry.mode === 'promptAtLaunch');
  const hasReporterField = template.fields.some((entry) => entry.fieldId === REPORTER_FIELD_ID);

  return (
    <section className={styles.section} aria-label={`Use template ${template.name}`}>
      <h2>Use “{template.name}”</h2>
      <p>{template.projectKey} · {template.issueTypeName}</p>

      {promptFields.length === 0 && <p>This template has no fields to fill in — just confirm to create the issue.</p>}
      {promptFields.map((entry) => {
        const descriptor = descriptorById.get(entry.fieldId);
        if (!descriptor) {
          return null;
        }
        return (
          <div className={styles.fieldRow} key={entry.fieldId}>
            <label className={styles.fieldLabel}>
              {entry.fieldName}
              {descriptor.required && <span className={styles.required} title="Required">*</span>}
            </label>
            <FieldValueInput
              descriptor={descriptor}
              value={launch.launchAnswers[entry.fieldId] ?? entry.defaultValue}
              onChange={(value) => launch.setLaunchAnswer(entry.fieldId, value)}
            />
          </div>
        );
      })}

      {!hasReporterField && (
        <p className={styles.unsupportedTag}>If Reporter isn’t set, the issue is created by the integration account.</p>
      )}

      {launch.missingRequiredNames.length > 0 && (
        <div className={styles.error} role="alert">
          Please provide these required field(s) before creating: {launch.missingRequiredNames.join(', ')}.
        </div>
      )}
      {launch.errorMessage && <div className={styles.error} role="alert">{launch.errorMessage}</div>}

      {launch.createdIssue ? (
        <p role="status">
          Created{' '}
          <a href={launch.createdIssue.browseUrl} rel="noreferrer" target="_blank">{launch.createdIssue.key} ↗</a>
        </p>
      ) : (
        <button
          className={styles.primaryButton}
          disabled={launch.isCreating}
          onClick={() => void launch.createFromTemplate(template, descriptors)}
          type="button"
        >
          {launch.isCreating ? 'Creating…' : 'Create issue'}
        </button>
      )}
      <button className={styles.toolbarButton} onClick={onClose} type="button" style={{ marginLeft: '0.5rem' }}>Close</button>
    </section>
  );
}
