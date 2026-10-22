// ProjectKeyPicker.tsx — The Wizard's Jira project picker: a find box that narrows Jira's own project list by key or
// name, and the list itself. The project is still picked from Jira's list, never typed into the record (pick, don't
// type); typing a key in full, or pressing Enter, just picks the best match faster than scrolling.

import { useState, type KeyboardEvent } from 'react';

import { findExactProjectKey, findProjects, labelProject, type ProjectChoice } from './projectSearch.ts';
import styles from './WizardShell.module.css';

/** What the picker needs: Jira's projects, the chosen key, and who to tell when another is chosen. */
export interface ProjectKeyPickerProps {
  id: string;
  projects: readonly ProjectChoice[];
  value: string;
  isLoading: boolean;
  onChoose: (projectKey: string) => void;
}

/** One line under the list: how many match, or that none do. */
function describeMatches(searchText: string, matchCount: number, projectCount: number): string {
  if (searchText.trim() === '') return '';
  if (matchCount === 0) return `No project key or name matches “${searchText.trim()}”.`;
  return `${matchCount} of ${projectCount} projects match.`;
}

/** The find box and the project list. */
export default function ProjectKeyPicker({ id, projects, value, isLoading, onChoose }: ProjectKeyPickerProps) {
  const [searchText, setSearchText] = useState('');
  const matches = findProjects(projects, searchText);
  // The chosen project stays listed while a search hides it, so the list never shows a different project than is saved.
  const chosenProject = projects.find((project) => project.key === value);
  const listedProjects = chosenProject && !matches.includes(chosenProject) ? [chosenProject, ...matches] : matches;
  const matchLine = describeMatches(searchText, matches.length, projects.length);

  function changeSearch(nextText: string) {
    setSearchText(nextText);
    const exactKey = findExactProjectKey(projects, nextText);
    if (exactKey !== '' && exactKey !== value) onChoose(exactKey);
  }

  function pickBestMatch(keyEvent: KeyboardEvent<HTMLInputElement>) {
    if (keyEvent.key !== 'Enter') return;
    keyEvent.preventDefault();
    if (matches.length > 0 && matches[0].key !== value) onChoose(matches[0].key);
  }

  return (
    <>
      <label className={styles.fieldLabel} htmlFor={`${id}-find`}>Find a project by key or name</label>
      <input id={`${id}-find`} type="search" className={styles.inputField} value={searchText} disabled={isLoading} placeholder="e.g. ENCUC"
        onChange={(changeEvent) => changeSearch(changeEvent.target.value)} onKeyDown={pickBestMatch} />
      <label className={styles.fieldLabel} htmlFor={id}>Jira project</label>
      <select id={id} className={styles.inputField} value={value} disabled={isLoading} onChange={(changeEvent) => onChoose(changeEvent.target.value)}>
        <option value="" disabled>{isLoading ? 'Loading Jira projects…' : '— Choose a project —'}</option>
        {listedProjects.map((project) => <option key={project.key} value={project.key}>{labelProject(project)}</option>)}
      </select>
      {matchLine === '' ? null : <p className={styles.hint} role="status">{matchLine}</p>}
    </>
  );
}
