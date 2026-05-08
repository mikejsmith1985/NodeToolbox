// index.tsx — Jira board picker that loads board metadata and stores the selected board ID.

import { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraBoard } from '../../types/jira.ts';
import styles from '../JiraPicker.module.css';

const BOARDS_API_PATH = '/rest/agile/1.0/board';
const DEFAULT_PLACEHOLDER = 'Select a board';
const LOADING_OPTION_LABEL = 'Loading boards…';
const ERROR_HINT_TEXT = 'Could not load Jira boards. You can still enter the board ID manually.';
const CURRENT_VALUE_LABEL_PREFIX = 'Current board';

interface JiraBoardResponse {
  values: JiraBoard[];
}

interface JiraBoardPickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (boardId: string) => void;
  placeholder?: string;
  projectKey?: string;
}

function buildBoardsApiPath(projectKey?: string): string {
  if (!projectKey) {
    return BOARDS_API_PATH;
  }

  return `${BOARDS_API_PATH}?projectKeyOrId=${encodeURIComponent(projectKey)}`;
}

function createCurrentBoardLabel(boardId: string): string {
  return `${CURRENT_VALUE_LABEL_PREFIX} (#${boardId})`;
}

/** Loads Jira boards and lets settings panels store the selected Jira board ID as a string. */
export default function JiraBoardPicker({
  id,
  label,
  value,
  onChange,
  placeholder,
  projectKey,
}: JiraBoardPickerProps) {
  const [availableBoards, setAvailableBoards] = useState<JiraBoard[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState(true);
  const [hasLoadingError, setHasLoadingError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadBoards(): Promise<void> {
      try {
        const loadedBoards = await jiraGet<JiraBoardResponse>(buildBoardsApiPath(projectKey));
        if (!isMounted) {
          return;
        }

        const selectableBoards = [...loadedBoards.values]
          .sort((leftBoard, rightBoard) => leftBoard.name.localeCompare(rightBoard.name));
        setAvailableBoards(selectableBoards);
        setHasLoadingError(false);
      } catch {
        if (!isMounted) {
          return;
        }

        setAvailableBoards([]);
        setHasLoadingError(true);
      } finally {
        if (isMounted) {
          setIsLoadingBoards(false);
        }
      }
    }

    setIsLoadingBoards(true);
    setHasLoadingError(false);
    void loadBoards();

    return () => {
      isMounted = false;
    };
  }, [projectKey]);

  const hasStoredBoardValue = useMemo(
    () => value.length > 0 && !availableBoards.some((board) => String(board.id) === value),
    [availableBoards, value],
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

  if (isLoadingBoards) {
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
        {hasStoredBoardValue && <option value={value}>{createCurrentBoardLabel(value)}</option>}
        {availableBoards.map((board) => (
          <option key={board.id} value={String(board.id)}>
            {board.name} (#{board.id})
          </option>
        ))}
      </select>
    </div>
  );
}
