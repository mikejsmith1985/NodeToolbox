// useMetricsState.ts — State, persistence, and Jira loading for the standalone Metrics view.
//
// The hook keeps Metrics independent from legacy ToolBox state while preserving the
// sprint-report math users already trust for predictability and throughput.

import { useCallback, useEffect, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { computeStats, daysBetween, type CycleTimeStats } from '../utils/cycleTime.ts';
import {
  averagePct,
  parseSprintReport,
  type GreenhopperIssue,
  type PredictabilityPoint,
  type SprintReportResponse,
} from '../utils/predictability.ts';

const DEFAULT_SPRINT_WINDOW = 6;
const MINIMUM_SPRINT_WINDOW = 1;
const MAXIMUM_CLOSED_SPRINTS = 100;
const CYCLE_TIME_MAX_RESULTS = 100;
const CYCLE_TIME_LOOKBACK_DAYS = 90;
const ZERO_TOTAL = 0;
const METRICS_CONFIG_STORAGE_KEY = 'tbxMetricsConfig';
const STORY_POINTS_FALLBACK = 0;
const GREENHOPPER_FORBIDDEN_STATUS = '403';
const GREENHOPPER_MISSING_STATUS = '404';
const INVALID_BOARD_MESSAGE = 'Could not load metrics for that board. Check the board ID and Jira permissions.';
const GREENHOPPER_UNAVAILABLE_MESSAGE =
  'Sprint report data is unavailable for this Jira site, so predictability and throughput are hidden.';

export type BoardType = 'scrum' | 'kanban' | 'unknown';

export interface ThroughputPoint {
  sprintId: number;
  sprintName: string;
  completedIssues: number;
  completedPoints: number;
}

export interface UseMetricsState {
  boardId: string;
  setBoardId: (id: string) => void;
  projectKey: string;
  setProjectKey: (key: string) => void;
  sprintWindow: number;
  setSprintWindow: (n: number) => void;
  boardType: BoardType | null;
  isLoading: boolean;
  errorMessage: string | null;
  predictability: PredictabilityPoint[];
  averageCompletionPct: number;
  throughput: ThroughputPoint[];
  cycleTime: CycleTimeStats | null;
  reload: () => Promise<void>;
}

interface MetricsConfig {
  boardId: string;
  projectKey: string;
  sprintWindow: number;
}

interface JiraBoardResponse {
  type?: string;
}

interface JiraSprint {
  id: number;
  name: string;
  startDate?: string;
}

interface JiraSprintListResponse {
  values?: JiraSprint[];
}

interface JiraDoneIssue {
  fields?: {
    created?: string;
    resolutiondate?: string | null;
    updated?: string;
  };
}

interface JiraSearchResponse {
  issues?: JiraDoneIssue[];
}

/** Owns Metrics inputs, persistence, and Jira calls so the render layer stays declarative. */
export function useMetricsState(): UseMetricsState {
  const storedConfig = readStoredConfig();
  const [boardId, setBoardId] = useState<string>(storedConfig.boardId);
  const [projectKey, setProjectKey] = useState<string>(storedConfig.projectKey);
  const [sprintWindow, setSprintWindowState] = useState<number>(storedConfig.sprintWindow);
  const [boardType, setBoardType] = useState<BoardType | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [predictability, setPredictability] = useState<PredictabilityPoint[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPoint[]>([]);
  const [cycleTime, setCycleTime] = useState<CycleTimeStats | null>(null);

  useEffect(() => {
    writeStoredConfig({ boardId, projectKey, sprintWindow });
  }, [boardId, projectKey, sprintWindow]);

  const setSprintWindow = useCallback((nextSprintWindow: number) => {
    setSprintWindowState(normalizeSprintWindow(nextSprintWindow));
  }, []);

  const reload = useCallback(async () => {
    const normalizedBoardId = boardId.trim();
    if (!isValidBoardId(normalizedBoardId)) {
      clearMetricResults(setBoardType, setPredictability, setThroughput, setCycleTime);
      setErrorMessage(normalizedBoardId ? 'Board ID must be numeric.' : null);
      return;
    }

    await loadMetrics(normalizedBoardId, projectKey, sprintWindow, {
      setBoardType,
      setCycleTime,
      setErrorMessage,
      setIsLoading,
      setPredictability,
      setThroughput,
    });
  }, [boardId, projectKey, sprintWindow]);

  return {
    boardId,
    setBoardId,
    projectKey,
    setProjectKey,
    sprintWindow,
    setSprintWindow,
    boardType,
    isLoading,
    errorMessage,
    predictability,
    averageCompletionPct: averagePct(predictability),
    throughput,
    cycleTime,
    reload,
  };
}

interface MetricsSetters {
  setBoardType: (boardType: BoardType | null) => void;
  setCycleTime: (cycleTime: CycleTimeStats | null) => void;
  setErrorMessage: (errorMessage: string | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  setPredictability: (predictability: PredictabilityPoint[]) => void;
  setThroughput: (throughput: ThroughputPoint[]) => void;
}

async function loadMetrics(
  normalizedBoardId: string,
  projectKey: string,
  sprintWindow: number,
  metricsSetters: MetricsSetters,
): Promise<void> {
  metricsSetters.setIsLoading(true);
  metricsSetters.setErrorMessage(null);
  try {
    const jiraBoardResponse = await jiraGet<JiraBoardResponse>(buildBoardPath(normalizedBoardId));
    const detectedBoardType = normalizeBoardType(jiraBoardResponse.type);
    metricsSetters.setBoardType(detectedBoardType);
    await loadBoardMetrics(normalizedBoardId, projectKey, sprintWindow, detectedBoardType, metricsSetters);
  } catch (caughtError: unknown) {
    handleLoadFailure(caughtError, metricsSetters);
  } finally {
    metricsSetters.setIsLoading(false);
  }
}

async function loadBoardMetrics(
  normalizedBoardId: string,
  projectKey: string,
  sprintWindow: number,
  detectedBoardType: BoardType,
  metricsSetters: MetricsSetters,
): Promise<void> {
  if (detectedBoardType === 'kanban') {
    metricsSetters.setPredictability([]);
    metricsSetters.setThroughput([]);
    metricsSetters.setCycleTime(await loadCycleTime(projectKey));
    return;
  }

  const closedSprints = await loadClosedSprints(normalizedBoardId, sprintWindow);
  const sprintMetrics = await loadSprintReportMetrics(normalizedBoardId, closedSprints);
  metricsSetters.setPredictability(sprintMetrics.predictability);
  metricsSetters.setThroughput(sprintMetrics.throughput);
  metricsSetters.setCycleTime(await loadCycleTime(projectKey));
}

async function loadClosedSprints(normalizedBoardId: string, sprintWindow: number): Promise<JiraSprint[]> {
  const sprintListPath = buildClosedSprintsPath(normalizedBoardId, sprintWindow);
  const jiraSprintListResponse = await jiraGet<JiraSprintListResponse>(sprintListPath);
  return (jiraSprintListResponse.values ?? []).sort(compareSprintsByStartDate).slice(-sprintWindow);
}

async function loadSprintReportMetrics(
  normalizedBoardId: string,
  closedSprints: JiraSprint[],
): Promise<{ predictability: PredictabilityPoint[]; throughput: ThroughputPoint[] }> {
  const sprintReports = await Promise.all(
    closedSprints.map((closedSprint) => loadSprintReport(normalizedBoardId, closedSprint)),
  );
  return {
    predictability: sprintReports.map(({ closedSprint, sprintReport }) => parseSprintReport(sprintReport, closedSprint)),
    throughput: sprintReports.map(({ closedSprint, sprintReport }) => parseThroughputPoint(sprintReport, closedSprint)),
  };
}

async function loadSprintReport(
  normalizedBoardId: string,
  closedSprint: JiraSprint,
): Promise<{ closedSprint: JiraSprint; sprintReport: SprintReportResponse }> {
  const sprintReport = await jiraGet<SprintReportResponse>(buildSprintReportPath(normalizedBoardId, closedSprint.id));
  return { closedSprint, sprintReport };
}

async function loadCycleTime(projectKey: string): Promise<CycleTimeStats | null> {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  if (!normalizedProjectKey) return null;

  const jiraSearchResponse = await jiraGet<JiraSearchResponse>(buildCycleTimePath(normalizedProjectKey));
  const cycleTimeDays = (jiraSearchResponse.issues ?? []).map(readCycleTimeDays).filter((dayValue) => dayValue !== null);
  return computeStats(cycleTimeDays);
}

function handleLoadFailure(caughtError: unknown, metricsSetters: MetricsSetters): void {
  clearMetricResults(metricsSetters.setBoardType, metricsSetters.setPredictability, metricsSetters.setThroughput, metricsSetters.setCycleTime);
  if (isGreenhopperAccessError(caughtError)) {
    metricsSetters.setErrorMessage(GREENHOPPER_UNAVAILABLE_MESSAGE);
    return;
  }
  metricsSetters.setErrorMessage(isBoardAccessError(caughtError) ? INVALID_BOARD_MESSAGE : readErrorMessage(caughtError));
}

function clearMetricResults(
  setBoardType: (boardType: BoardType | null) => void,
  setPredictability: (predictability: PredictabilityPoint[]) => void,
  setThroughput: (throughput: ThroughputPoint[]) => void,
  setCycleTime: (cycleTime: CycleTimeStats | null) => void,
): void {
  setBoardType(null);
  setPredictability([]);
  setThroughput([]);
  setCycleTime(null);
}

function parseThroughputPoint(sprintReport: SprintReportResponse, closedSprint: JiraSprint): ThroughputPoint {
  const completedIssues = sprintReport.contents?.completedIssues ?? [];
  return {
    sprintId: closedSprint.id,
    sprintName: closedSprint.name,
    completedIssues: completedIssues.length,
    completedPoints: sumThroughputPoints(completedIssues),
  };
}

function sumThroughputPoints(completedIssues: GreenhopperIssue[]): number {
  return completedIssues.reduce((runningTotal, completedIssue) => runningTotal + readThroughputPoints(completedIssue), ZERO_TOTAL);
}

function readThroughputPoints(completedIssue: GreenhopperIssue): number {
  const currentEstimate = readNumericEstimate(completedIssue.currentEstimateStatistic?.statFieldValue?.value);
  if (currentEstimate !== null) return currentEstimate;
  return readNumericEstimate(completedIssue.estimateStatistic?.statFieldValue?.value) ?? STORY_POINTS_FALLBACK;
}

function readNumericEstimate(candidateValue: number | string | null | undefined): number | null {
  const numericEstimate = typeof candidateValue === 'number' ? candidateValue : Number.parseFloat(candidateValue ?? '');
  return Number.isFinite(numericEstimate) ? numericEstimate : null;
}

function readCycleTimeDays(jiraDoneIssue: JiraDoneIssue): number | null {
  const createdDate = jiraDoneIssue.fields?.created;
  const finishedDate = jiraDoneIssue.fields?.resolutiondate ?? jiraDoneIssue.fields?.updated;
  if (!createdDate || !finishedDate) return null;
  return daysBetween(createdDate, finishedDate);
}

function compareSprintsByStartDate(firstSprint: JiraSprint, secondSprint: JiraSprint): number {
  return readSprintTimestamp(firstSprint) - readSprintTimestamp(secondSprint);
}

function readSprintTimestamp(jiraSprint: JiraSprint): number {
  const parsedTimestamp = new Date(jiraSprint.startDate ?? '').getTime();
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : ZERO_TOTAL;
}

function normalizeBoardType(candidateType: string | undefined): BoardType {
  if (candidateType === 'scrum' || candidateType === 'kanban') return candidateType;
  return 'unknown';
}

function isValidBoardId(candidateBoardId: string): boolean {
  return /^\d+$/.test(candidateBoardId);
}

function normalizeSprintWindow(nextSprintWindow: number): number {
  if (!Number.isFinite(nextSprintWindow)) return DEFAULT_SPRINT_WINDOW;
  return Math.max(MINIMUM_SPRINT_WINDOW, Math.round(nextSprintWindow));
}

function buildBoardPath(normalizedBoardId: string): string {
  return `/rest/agile/1.0/board/${encodeURIComponent(normalizedBoardId)}`;
}

function buildClosedSprintsPath(normalizedBoardId: string, sprintWindow: number): string {
  const maxResults = Math.min(MAXIMUM_CLOSED_SPRINTS, normalizeSprintWindow(sprintWindow));
  return `/rest/agile/1.0/board/${encodeURIComponent(normalizedBoardId)}/sprint?state=closed&maxResults=${maxResults}&orderBy=startDate`;
}

function buildSprintReportPath(normalizedBoardId: string, sprintId: number): string {
  return `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${encodeURIComponent(normalizedBoardId)}&sprintId=${sprintId}`;
}

function buildCycleTimePath(normalizedProjectKey: string): string {
  const cycleTimeJql = `project=${normalizedProjectKey} AND statusCategory=Done AND updated >= -${CYCLE_TIME_LOOKBACK_DAYS}d`;
  return `/rest/api/2/search?jql=${encodeURIComponent(cycleTimeJql)}&maxResults=${CYCLE_TIME_MAX_RESULTS}&fields=created,resolutiondate,updated`;
}

function readStoredConfig(): MetricsConfig {
  const storedConfigText = window.localStorage.getItem(METRICS_CONFIG_STORAGE_KEY);
  if (!storedConfigText) return createDefaultConfig();

  try {
    return sanitizeStoredConfig(JSON.parse(storedConfigText) as Partial<MetricsConfig>);
  } catch {
    return createDefaultConfig();
  }
}

function writeStoredConfig(metricsConfig: MetricsConfig): void {
  window.localStorage.setItem(METRICS_CONFIG_STORAGE_KEY, JSON.stringify(metricsConfig));
}

function sanitizeStoredConfig(metricsConfig: Partial<MetricsConfig>): MetricsConfig {
  return {
    boardId: typeof metricsConfig.boardId === 'string' ? metricsConfig.boardId : '',
    projectKey: typeof metricsConfig.projectKey === 'string' ? metricsConfig.projectKey : '',
    sprintWindow: normalizeSprintWindow(metricsConfig.sprintWindow ?? DEFAULT_SPRINT_WINDOW),
  };
}

function createDefaultConfig(): MetricsConfig {
  return { boardId: '', projectKey: '', sprintWindow: DEFAULT_SPRINT_WINDOW };
}

function isGreenhopperAccessError(caughtError: unknown): boolean {
  const errorMessage = readErrorMessage(caughtError);
  const hasGreenhopperPath = errorMessage.includes('/rest/greenhopper/');
  return hasGreenhopperPath && (errorMessage.includes(GREENHOPPER_FORBIDDEN_STATUS) || errorMessage.includes(GREENHOPPER_MISSING_STATUS));
}

function isBoardAccessError(caughtError: unknown): boolean {
  const errorMessage = readErrorMessage(caughtError);
  return errorMessage.includes('/rest/agile/1.0/board/') && errorMessage.includes(GREENHOPPER_MISSING_STATUS);
}

function readErrorMessage(caughtError: unknown): string {
  return caughtError instanceof Error ? caughtError.message : 'Failed to load Metrics data';
}
