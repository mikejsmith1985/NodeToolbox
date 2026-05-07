// useStoryPointingState.ts — State and Jira persistence for the Story Pointing view.
//
// This hook ports the high-value legacy Story Pointing behaviour into a single-user
// React flow: load a planning deck, show one issue at a time, choose a Fibonacci
// estimate, reveal it, and optionally save the final numeric value to Jira. The
// legacy multi-user relay/WebSocket voting model is intentionally deferred because
// NodeToolbox does not yet have a shared real-time planning backend.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet, jiraPut } from '../../../services/jiraApi.ts';

// ── Named constants — legacy-compatible storage and Jira request details. ───────

/** Legacy-compatible key so a browser refresh keeps the facilitator's current deck. */
export const STORY_POINTING_STORAGE_KEY = 'tbxStoryPointingState';

/** Default search mirrors the legacy view's bias toward unresolved, unpointed work. */
const DEFAULT_POINTING_JQL = 'statusCategory != Done ORDER BY priority DESC, created ASC';

/** Jira caps search pages; 50 keeps the solo pointing deck useful without feeling slow. */
const POINTING_MAX_RESULTS = 50;

/** Jira fields needed for the single issue card and optional story point save. */
const POINTING_FIELDS = [
  'summary',
  'description',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'customfield_10016',
  'customfield_10028',
].join(',');

/** NodeToolbox uses the newer Jira story-points field when saving estimates. */
const STORY_POINTS_FIELD_ID = 'customfield_10028';
const STORY_POINTS_FALLBACK_FIELD_ID = 'customfield_10016';

/** Issue-key parsing accepts common Jira project keys without accepting arbitrary JQL fragments. */
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/i;
const ISSUE_KEY_SPLIT_PATTERN = /[\s,]+/;

/** Numeric deck navigation constants make boundary handling readable and testable. */
const FIRST_ISSUE_INDEX = 0;
const NEXT_ISSUE_STEP = 1;
const EMPTY_COUNT = 0;

/** Planning-poker card values shown by the render layer. */
export const POINTING_SCALE = [1, 2, 3, 5, 8, 13, 21, '?'] as const;

// ── Public types exposed to the view and tests. ────────────────────────────────

export type StoryPointVote = (typeof POINTING_SCALE)[number];

export interface StoryPointingIssue {
  key: string;
  summary: string;
  description: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  storyPoints: number;
}

export interface StoryPointingSession {
  pointedCount: number;
  skippedCount: number;
}

export interface PersistedStoryPointingState {
  queryText: string;
  deck: StoryPointingIssue[];
  currentIssueIndex: number;
  selectedVote: StoryPointVote | null;
  isRevealed: boolean;
  session: StoryPointingSession;
}

export interface StoryPointingState extends PersistedStoryPointingState {
  currentIssue: StoryPointingIssue | null;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  saveStatusMessage: string | null;
  canRevealVote: boolean;
  canPersistVote: boolean;
}

export interface StoryPointingActions {
  setQueryText: (queryText: string) => void;
  loadIssues: () => Promise<void>;
  selectVote: (selectedVote: StoryPointVote) => void;
  revealVotes: () => void;
  resetVote: () => void;
  skipIssue: () => void;
  goToPreviousIssue: () => void;
  goToIssue: (issueIndex: number) => void;
  saveRevealedVote: () => Promise<void>;
  clearDeck: () => void;
}

// ── Jira response shape (narrow — only fields consumed by this view). ──────────

interface JiraSearchResponse {
  issues: JiraIssueResponse[];
}

interface JiraIssueResponse {
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string } | null;
    priority?: { name?: string } | null;
    issuetype?: { name?: string } | null;
    assignee?: { displayName?: string } | null;
    [customField: string]: unknown;
  };
}

// ── Pure helpers. ──────────────────────────────────────────────────────────────

/** Builds a Jira search path from either saved-filter JQL or comma-separated issue keys. */
export function buildIssueSearchPath(queryText: string): string {
  const normalizedQueryText = queryText.trim() || DEFAULT_POINTING_JQL;
  const issueKeys = parseIssueKeys(normalizedQueryText);
  const jqlText = issueKeys.length > EMPTY_COUNT ? `issuekey in (${issueKeys.join(', ')})` : normalizedQueryText;
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&maxResults=${POINTING_MAX_RESULTS}&fields=${POINTING_FIELDS}`;
}

/** Maps Jira's nested REST response into the flat card shape used by the view. */
export function mapJiraIssueToStoryPointingIssue(rawIssue: JiraIssueResponse): StoryPointingIssue {
  const fieldsObject = rawIssue.fields ?? {};
  return {
    key: rawIssue.key,
    summary: fieldsObject.summary ?? '',
    description: readPlainTextDescription(fieldsObject.description),
    issueType: fieldsObject.issuetype?.name ?? '',
    status: fieldsObject.status?.name ?? '',
    priority: fieldsObject.priority?.name ?? '',
    assignee: fieldsObject.assignee?.displayName ?? '',
    storyPoints: readStoryPoints(fieldsObject),
  };
}

/** Tells the view when a revealed vote is safe to persist to Jira as story points. */
export function computeCanPersistVote(selectedVote: StoryPointVote | null, isRevealed: boolean): boolean {
  return isRevealed && typeof selectedVote === 'number';
}

// ── Internal helpers. ──────────────────────────────────────────────────────────

function parseIssueKeys(queryText: string): string[] {
  const candidateKeys = queryText.split(ISSUE_KEY_SPLIT_PATTERN).filter(Boolean);
  if (candidateKeys.length === EMPTY_COUNT) return [];
  const hasOnlyIssueKeys = candidateKeys.every((candidateKey) => ISSUE_KEY_PATTERN.test(candidateKey));
  return hasOnlyIssueKeys ? candidateKeys.map((candidateKey) => candidateKey.toUpperCase()) : [];
}

function readStoryPoints(fieldsObject: Record<string, unknown>): number {
  const preferredValue = fieldsObject[STORY_POINTS_FIELD_ID];
  const fallbackValue = fieldsObject[STORY_POINTS_FALLBACK_FIELD_ID];
  if (typeof preferredValue === 'number') return preferredValue;
  if (typeof fallbackValue === 'number') return fallbackValue;
  return EMPTY_COUNT;
}

function readPlainTextDescription(descriptionValue: unknown): string {
  if (typeof descriptionValue === 'string') return descriptionValue;
  if (!isRecord(descriptionValue)) return '';
  const extractedText = collectAtlassianDocumentText(descriptionValue).trim();
  return extractedText;
}

function collectAtlassianDocumentText(documentNode: unknown): string {
  if (!isRecord(documentNode)) return '';
  const nodeText = typeof documentNode.text === 'string' ? documentNode.text : '';
  const contentNodes = Array.isArray(documentNode.content) ? documentNode.content : [];
  const childText = contentNodes.map(collectAtlassianDocumentText).filter(Boolean).join(' ');
  return [nodeText, childText].filter(Boolean).join(' ');
}

function isRecord(valueToCheck: unknown): valueToCheck is Record<string, unknown> {
  return typeof valueToCheck === 'object' && valueToCheck !== null;
}

function buildDefaultPersistedState(): PersistedStoryPointingState {
  return {
    queryText: DEFAULT_POINTING_JQL,
    deck: [],
    currentIssueIndex: FIRST_ISSUE_INDEX,
    selectedVote: null,
    isRevealed: false,
    session: { pointedCount: EMPTY_COUNT, skippedCount: EMPTY_COUNT },
  };
}

function readPersistedStoryPointingState(): PersistedStoryPointingState {
  try {
    const storedJson = window.localStorage.getItem(STORY_POINTING_STORAGE_KEY);
    if (!storedJson) return buildDefaultPersistedState();
    return normalizePersistedState(JSON.parse(storedJson) as unknown);
  } catch {
    return buildDefaultPersistedState();
  }
}

function normalizePersistedState(candidateState: unknown): PersistedStoryPointingState {
  if (!isRecord(candidateState)) return buildDefaultPersistedState();
  const defaultState = buildDefaultPersistedState();
  const persistedDeck = Array.isArray(candidateState.deck) ? candidateState.deck.filter(isStoryPointingIssue) : [];
  return {
    queryText: typeof candidateState.queryText === 'string' ? candidateState.queryText : defaultState.queryText,
    deck: persistedDeck,
    currentIssueIndex: normalizeIssueIndex(candidateState.currentIssueIndex, persistedDeck.length),
    selectedVote: normalizeSelectedVote(candidateState.selectedVote),
    isRevealed: candidateState.isRevealed === true,
    session: normalizeSession(candidateState.session),
  };
}

function isStoryPointingIssue(candidateIssue: unknown): candidateIssue is StoryPointingIssue {
  if (!isRecord(candidateIssue)) return false;
  return typeof candidateIssue.key === 'string' && typeof candidateIssue.summary === 'string';
}

function normalizeIssueIndex(candidateIndex: unknown, deckLength: number): number {
  if (typeof candidateIndex !== 'number' || !Number.isInteger(candidateIndex)) return FIRST_ISSUE_INDEX;
  if (deckLength === EMPTY_COUNT) return FIRST_ISSUE_INDEX;
  return Math.min(Math.max(candidateIndex, FIRST_ISSUE_INDEX), deckLength - NEXT_ISSUE_STEP);
}

function normalizeSelectedVote(candidateVote: unknown): StoryPointVote | null {
  return POINTING_SCALE.some((pointingValue) => pointingValue === candidateVote) ? (candidateVote as StoryPointVote) : null;
}

function normalizeSession(candidateSession: unknown): StoryPointingSession {
  if (!isRecord(candidateSession)) return { pointedCount: EMPTY_COUNT, skippedCount: EMPTY_COUNT };
  return {
    pointedCount: typeof candidateSession.pointedCount === 'number' ? candidateSession.pointedCount : EMPTY_COUNT,
    skippedCount: typeof candidateSession.skippedCount === 'number' ? candidateSession.skippedCount : EMPTY_COUNT,
  };
}

function writePersistedStoryPointingState(persistedState: PersistedStoryPointingState): void {
  try {
    window.localStorage.setItem(STORY_POINTING_STORAGE_KEY, JSON.stringify(persistedState));
  } catch {
    // Browsers can block localStorage; pointing remains usable for the current tab.
  }
}

function advanceIssueIndex(currentIssueIndex: number, deckLength: number): number {
  const nextIssueIndex = currentIssueIndex + NEXT_ISSUE_STEP;
  if (nextIssueIndex >= deckLength) return currentIssueIndex;
  return nextIssueIndex;
}

// ── Hook. ──────────────────────────────────────────────────────────────────────

/** Owns the single-user Story Pointing workflow so the view can stay declarative and easy to test. */
export function useStoryPointingState(): StoryPointingState & StoryPointingActions {
  const [persistedState, setPersistedState] = useState<PersistedStoryPointingState>(readPersistedStoryPointingState);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    writePersistedStoryPointingState(persistedState);
  }, [persistedState]);

  const setQueryText = useCallback((queryText: string) => {
    setPersistedState((previousState) => ({ ...previousState, queryText }));
  }, []);

  const loadIssues = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const searchResponse = await jiraGet<JiraSearchResponse>(buildIssueSearchPath(persistedState.queryText));
      const loadedDeck = (searchResponse.issues ?? []).map(mapJiraIssueToStoryPointingIssue);
      setPersistedState((previousState) => ({
        ...previousState,
        deck: loadedDeck,
        currentIssueIndex: FIRST_ISSUE_INDEX,
        selectedVote: null,
        isRevealed: false,
      }));
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to load Jira issues';
      setLoadError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [persistedState.queryText]);

  const selectVote = useCallback((selectedVote: StoryPointVote) => {
    setPersistedState((previousState) => ({ ...previousState, selectedVote, isRevealed: false }));
    setSaveStatusMessage(null);
  }, []);

  const revealVotes = useCallback(() => {
    setPersistedState((previousState) => ({ ...previousState, isRevealed: previousState.selectedVote !== null }));
  }, []);

  const resetVote = useCallback(() => {
    setPersistedState((previousState) => ({ ...previousState, selectedVote: null, isRevealed: false }));
    setSaveStatusMessage(null);
  }, []);

  const skipIssue = useCallback(() => {
    setPersistedState((previousState) => ({
      ...previousState,
      currentIssueIndex: advanceIssueIndex(previousState.currentIssueIndex, previousState.deck.length),
      selectedVote: null,
      isRevealed: false,
      session: { ...previousState.session, skippedCount: previousState.session.skippedCount + NEXT_ISSUE_STEP },
    }));
  }, []);

  const goToPreviousIssue = useCallback(() => {
    setPersistedState((previousState) => ({
      ...previousState,
      currentIssueIndex: Math.max(FIRST_ISSUE_INDEX, previousState.currentIssueIndex - NEXT_ISSUE_STEP),
      selectedVote: null,
      isRevealed: false,
    }));
  }, []);

  const goToIssue = useCallback((issueIndex: number) => {
    setPersistedState((previousState) => ({
      ...previousState,
      currentIssueIndex: normalizeIssueIndex(issueIndex, previousState.deck.length),
      selectedVote: null,
      isRevealed: false,
    }));
  }, []);

  const saveRevealedVote = useCallback(async () => {
    const currentIssue = persistedState.deck[persistedState.currentIssueIndex] ?? null;
    if (!currentIssue || !computeCanPersistVote(persistedState.selectedVote, persistedState.isRevealed)) return;
    const selectedNumericVote = persistedState.selectedVote;
    if (typeof selectedNumericVote !== 'number') return;
    setIsSaving(true);
    try {
      await jiraPut(`/rest/api/2/issue/${encodeURIComponent(currentIssue.key)}`, {
        fields: { [STORY_POINTS_FIELD_ID]: selectedNumericVote },
      });
      setSaveStatusMessage(`✅ Saved ${currentIssue.key} as ${selectedNumericVote} points`);
      setPersistedState((previousState) => updateStateAfterSave(previousState, currentIssue.key, selectedNumericVote));
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to save story points';
      setSaveStatusMessage(`⚠ ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  }, [persistedState]);

  const clearDeck = useCallback(() => {
    setPersistedState(buildDefaultPersistedState());
    setLoadError(null);
    setSaveStatusMessage(null);
  }, []);

  return useMemo(() => {
    const currentIssue = persistedState.deck[persistedState.currentIssueIndex] ?? null;
    const canRevealVote = persistedState.selectedVote !== null;
    const canPersistVote = computeCanPersistVote(persistedState.selectedVote, persistedState.isRevealed);
    return {
      ...persistedState,
      currentIssue,
      isLoading,
      isSaving,
      loadError,
      saveStatusMessage,
      canRevealVote,
      canPersistVote,
      setQueryText,
      loadIssues,
      selectVote,
      revealVotes,
      resetVote,
      skipIssue,
      goToPreviousIssue,
      goToIssue,
      saveRevealedVote,
      clearDeck,
    };
  }, [
    persistedState,
    isLoading,
    isSaving,
    loadError,
    saveStatusMessage,
    setQueryText,
    loadIssues,
    selectVote,
    revealVotes,
    resetVote,
    skipIssue,
    goToPreviousIssue,
    goToIssue,
    saveRevealedVote,
    clearDeck,
  ]);
}

function updateStateAfterSave(
  previousState: PersistedStoryPointingState,
  savedIssueKey: string,
  savedVote: number,
): PersistedStoryPointingState {
  return {
    ...previousState,
    deck: previousState.deck.map((deckIssue) =>
      deckIssue.key === savedIssueKey ? { ...deckIssue, storyPoints: savedVote } : deckIssue,
    ),
    currentIssueIndex: advanceIssueIndex(previousState.currentIssueIndex, previousState.deck.length),
    selectedVote: null,
    isRevealed: false,
    session: { ...previousState.session, pointedCount: previousState.session.pointedCount + NEXT_ISSUE_STEP },
  };
}
