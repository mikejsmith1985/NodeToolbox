// index.tsx — Jira project picker that loads project metadata and stores the selected project key.

import { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraProject } from '../../types/jira.ts';
import styles from '../JiraPicker.module.css';

const PROJECTS_API_PATH = '/rest/api/2/project';
const DEFAULT_PLACEHOLDER = 'Select a project';
const LOADING_OPTION_LABEL = 'Loading projects…';
const ERROR_HINT_TEXT = 'Could not load Jira projects. You can still enter the project key manually.';
const CURRENT_VALUE_LABEL_PREFIX = 'Current project';

interface JiraProjectPickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (projectKey: string) => void;
  placeholder?: string;
}

function createCurrentProjectLabel(projectKey: string): string {
  return `${CURRENT_VALUE_LABEL_PREFIX} (${projectKey})`;
}

/** Loads Jira projects and lets settings panels store the selected Jira project key. */
export default function JiraProjectPicker({
  id,
  label,
  value,
  onChange,
  placeholder,
}: JiraProjectPickerProps) {
  const [availableProjects, setAvailableProjects] = useState<JiraProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [hasLoadingError, setHasLoadingError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadProjects(): Promise<void> {
      try {
        const loadedProjects = await jiraGet<JiraProject[]>(PROJECTS_API_PATH);
        if (!isMounted) {
          return;
        }

        const selectableProjects = [...loadedProjects]
          .sort((leftProject, rightProject) => leftProject.name.localeCompare(rightProject.name));
        setAvailableProjects(selectableProjects);
        setHasLoadingError(false);
      } catch {
        if (!isMounted) {
          return;
        }

        setAvailableProjects([]);
        setHasLoadingError(true);
      } finally {
        if (isMounted) {
          setIsLoadingProjects(false);
        }
      }
    }

    void loadProjects();

    return () => {
      isMounted = false;
    };
  }, []);

  const hasStoredProjectValue = useMemo(
    () => value.length > 0 && !availableProjects.some((project) => project.key === value),
    [availableProjects, value],
  );

  if (hasLoadingError) {
    return (
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={id}>{label}</label>
        <input
          className={styles.fallbackInput}
          id={id}
          onChange={(changeEvent) => onChange(changeEvent.target.value)}
          type="text"
          value={value}
        />
        <p className={styles.errorHint}>{ERROR_HINT_TEXT}</p>
      </div>
    );
  }

  if (isLoadingProjects) {
    return (
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={id}>{label}</label>
        <select className={styles.select} defaultValue="" disabled id={id}>
          <option value="">{LOADING_OPTION_LABEL}</option>
        </select>
      </div>
    );
  }

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <select
        className={styles.select}
        id={id}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        value={value}
      >
        <option disabled value="">— {placeholder ?? DEFAULT_PLACEHOLDER} —</option>
        {hasStoredProjectValue && <option value={value}>{createCurrentProjectLabel(value)}</option>}
        {availableProjects.map((project) => (
          <option key={project.key} value={project.key}>
            {project.name} ({project.key})
          </option>
        ))}
      </select>
    </div>
  );
}
