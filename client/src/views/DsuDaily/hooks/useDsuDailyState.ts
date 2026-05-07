// useDsuDailyState.ts — State, persistence, clipboard, and Jira comment posting for DSU Daily.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import {
  buildBulletList,
  classifyByDate,
  formatStandupText,
  type DsuDraft,
  type DsuIssue,
} from '../utils/dsuFormat.ts';

const DSU_DRAFT_STORAGE_KEY = 'tbxDsuDraft';
const CURRENT_USER_PATH = '/rest/api/2/myself';
const ACTIVITY_SEARCH_PATH =
  '/rest/api/2/search?jql=assignee = currentUser() AND updated >= -7d&fields=summary,status,updated&maxResults=100';
const YESTERDAY_EMPTY_TEXT = '• (nothing updated yesterday)';
const TODAY_EMPTY_TEXT = '• (no active issues assigned)';
const ISO_DATE_LENGTH = 10;

const EMPTY_DRAFT: DsuDraft = {
  yesterday: '',
  today: '',
  blockers: '',
};

type PostStatus = 'idle' | 'posting' | 'success' | 'error';
type DraftUpdater = (currentDraft: DsuDraft) => DsuDraft;

interface JiraUserResponse {
  accountId: string;
  displayName: string;
}

interface JiraSearchResponse {
  issues: DsuIssue[];
}

export interface UseDsuDailyState {
  draft: DsuDraft;
  setYesterday: (text: string) => void;
  setToday: (text: string) => void;
  setBlockers: (text: string) => void;
  isLoading: boolean;
  errorMessage: string | null;
  postKey: string;
  setPostKey: (key: string) => void;
  postStatus: PostStatus;
  postError: string | null;
  refresh: () => Promise<void>;
  copy: () => Promise<boolean>;
  postComment: () => Promise<void>;
  formattedText: string;
}

function readPersistedDraft(): DsuDraft {
  try {
    const rawJson = window.localStorage.getItem(DSU_DRAFT_STORAGE_KEY);
    if (!rawJson) return EMPTY_DRAFT;
    return normalizeDraft(JSON.parse(rawJson));
  } catch {
    return EMPTY_DRAFT;
  }
}

function writePersistedDraft(draft: DsuDraft): void {
  try {
    window.localStorage.setItem(DSU_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Draft saving should never block standup editing if browser storage is unavailable.
  }
}

function normalizeDraft(possibleDraft: unknown): DsuDraft {
  if (!possibleDraft || typeof possibleDraft !== 'object') return EMPTY_DRAFT;
  const draftRecord = possibleDraft as Partial<DsuDraft>;
  return {
    yesterday: typeof draftRecord.yesterday === 'string' ? draftRecord.yesterday : '',
    today: typeof draftRecord.today === 'string' ? draftRecord.today : '',
    blockers: typeof draftRecord.blockers === 'string' ? draftRecord.blockers : '',
  };
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

/** Owns the editable DSU Daily draft, Jira activity refresh, clipboard copy, and comment posting. */
export function useDsuDailyState(): UseDsuDailyState {
  const [draft, setDraft] = useState<DsuDraft>(readPersistedDraft);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [postKey, setPostKey] = useState('');
  const [postStatus, setPostStatus] = useState<PostStatus>('idle');
  const [postError, setPostError] = useState<string | null>(null);
  const shouldPersistDraftRef = useRef(false);

  const formattedText = useMemo(() => formatStandupText(draft), [draft]);

  useEffect(() => {
    if (!shouldPersistDraftRef.current) return;
    writePersistedDraft(draft);
  }, [draft]);

  const updateDraft = useCallback((createNextDraft: DraftUpdater) => {
    shouldPersistDraftRef.current = true;
    setDraft((currentDraft) => createNextDraft(currentDraft));
  }, []);

  const setYesterday = useCallback(
    (text: string) => updateDraft((currentDraft) => ({ ...currentDraft, yesterday: text })),
    [updateDraft],
  );
  const setToday = useCallback(
    (text: string) => updateDraft((currentDraft) => ({ ...currentDraft, today: text })),
    [updateDraft],
  );
  const setBlockers = useCallback(
    (text: string) => updateDraft((currentDraft) => ({ ...currentDraft, blockers: text })),
    [updateDraft],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await jiraGet<JiraUserResponse>(CURRENT_USER_PATH);
      const searchResponse = await jiraGet<JiraSearchResponse>(ACTIVITY_SEARCH_PATH);
      const classifiedIssues = classifyByDate(searchResponse.issues ?? [], getTodayIso());
      updateDraft(() => ({
        yesterday: buildBulletList(classifiedIssues.yesterdayList, YESTERDAY_EMPTY_TEXT),
        today: buildBulletList(classifiedIssues.todayList, TODAY_EMPTY_TEXT),
        blockers: '',
      }));
    } catch (caughtError: unknown) {
      const refreshError = caughtError instanceof Error ? caughtError.message : 'Unknown Jira error';
      setErrorMessage(`Could not refresh DSU Daily activity. ${refreshError}`);
    } finally {
      setIsLoading(false);
    }
  }, [updateDraft]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      return true;
    } catch {
      return false;
    }
  }, [formattedText]);

  const postComment = useCallback(async () => {
    const trimmedPostKey = postKey.trim().toUpperCase();
    if (!trimmedPostKey) {
      setPostStatus('error');
      setPostError('Enter an issue key before posting.');
      return;
    }
    setPostStatus('posting');
    setPostError(null);
    try {
      await jiraPost<unknown>(`/rest/api/2/issue/${encodeURIComponent(trimmedPostKey)}/comment`, { body: formattedText });
      setPostStatus('success');
    } catch (caughtError: unknown) {
      const commentError = caughtError instanceof Error ? caughtError.message : 'Post failed';
      setPostStatus('error');
      setPostError(commentError);
    }
  }, [formattedText, postKey]);

  return {
    draft,
    setYesterday,
    setToday,
    setBlockers,
    isLoading,
    errorMessage,
    postKey,
    setPostKey,
    postStatus,
    postError,
    refresh,
    copy,
    postComment,
    formattedText,
  };
}
