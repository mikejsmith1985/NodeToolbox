// schedulerApi.ts — Typed client for scheduler-backed repo monitor endpoints.

const SCHEDULER_STATUS_ENDPOINT = '/api/scheduler/status';
const SCHEDULER_CONFIG_ENDPOINT = '/api/scheduler/config';
const SCHEDULER_RUN_NOW_ENDPOINT = '/api/scheduler/run-now';
const SCHEDULER_RESULTS_ENDPOINT = '/api/scheduler/results';
const SCHEDULER_VALIDATE_ENDPOINT = '/api/scheduler/validate';
const SCHEDULER_GITHUB_DEBUG_ENDPOINT = '/api/scheduler/github-debug';
const JSON_CONTENT_TYPE = 'application/json';

export interface RepoMonitorTransitions {
  branchCreated: string;
  commitPushed: string;
  prOpened: string;
  prMerged: string;
}

export interface RepoMonitorSchedulerConfig {
  enabled: boolean;
  repos: string[];
  branchPattern: string;
  intervalMin: number;
  transitions: RepoMonitorTransitions;
}

export interface SchedulerConfigResponse {
  repoMonitor: RepoMonitorSchedulerConfig;
}

export interface SchedulerStatusResponse {
  repoMonitor: {
    enabled: boolean;
    repos: string[];
    intervalMin: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
    eventCount: number;
  };
}

export interface SchedulerResultEvent {
  repo: string;
  eventType: string;
  jiraKey: string;
  message: string;
  isSuccess: boolean;
  timestamp: string;
  source: 'server';
}

export interface SchedulerResultsResponse {
  repoMonitor: {
    lastRunAt: string | null;
    nextRunAt: string | null;
    eventCount: number;
    events: SchedulerResultEvent[];
  };
}

export interface SchedulerValidationRepoResult {
  repo: string;
  isReachable: boolean;
  branchesHttpStatus: number | null;
  pullsHttpStatus: number | null;
  branchProbeCount: number;
  pullRequestProbeCount: number;
  probeErrorMessage: string | null;
}

export interface SchedulerValidationResponse {
  repoMonitor: {
    checkedAt: string;
    isGitHubConfigured: boolean;
    isGitHubReachable: boolean;
    configuredRepoCount: number;
    reachableRepoCount: number;
    unreachableRepoCount: number;
    probeErrorMessage: string | null;
    validationMode: string;
    repos: SchedulerValidationRepoResult[];
  };
}

export interface GitHubDebugInfo {
  pat: string | null;
  baseUrl: string;
  authHeaderFormat: string;
  expectedHeader?: string;
  sentHeader?: string;
}

export interface GitHubProbeResult {
  endpoint: string;
  method: string;
  statusCode: number;
  statusText: string;
  responseTime: number;
  success: boolean;
  errorMessage?: string;
}

export interface GitHubDebugResponse {
  isConfigured: boolean;
  message?: string;
  timestamp?: string;
  debugInfo: GitHubDebugInfo;
  probeResult?: GitHubProbeResult;
  error?: string;
}

function assertSuccessfulResponse(response: Response, messagePrefix: string): void {
  if (!response.ok) {
    throw new Error(`${messagePrefix}: ${response.status}`);
  }
}

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

/** Reads non-sensitive scheduler monitor configuration used by Repo Monitor UX. */
export async function fetchSchedulerConfig(): Promise<SchedulerConfigResponse> {
  const response = await fetch(SCHEDULER_CONFIG_ENDPOINT);
  assertSuccessfulResponse(response, 'scheduler-config fetch failed');
  return parseJsonResponse<SchedulerConfigResponse>(response);
}

/** Reads current scheduler runtime status (enabled flag, next run, and event count). */
export async function fetchSchedulerStatus(): Promise<SchedulerStatusResponse> {
  const response = await fetch(SCHEDULER_STATUS_ENDPOINT);
  assertSuccessfulResponse(response, 'scheduler-status fetch failed');
  return parseJsonResponse<SchedulerStatusResponse>(response);
}

/** Reads the latest scheduler result event log from the server ring buffer. */
export async function fetchSchedulerResults(): Promise<SchedulerResultsResponse> {
  const response = await fetch(SCHEDULER_RESULTS_ENDPOINT);
  assertSuccessfulResponse(response, 'scheduler-results fetch failed');
  return parseJsonResponse<SchedulerResultsResponse>(response);
}

/** Saves scheduler configuration updates so monitor repos/rules mirror legacy behavior. */
export async function updateSchedulerConfig(config: SchedulerConfigResponse): Promise<void> {
  const response = await fetch(SCHEDULER_CONFIG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(config),
  });
  assertSuccessfulResponse(response, 'scheduler-config update failed');
}

/** Triggers an immediate scheduler run against configured monitor repos/rules. */
export async function runSchedulerNow(): Promise<void> {
  const response = await fetch(SCHEDULER_RUN_NOW_ENDPOINT, { method: 'POST' });
  assertSuccessfulResponse(response, 'scheduler run-now failed');
}

/** Performs a read-only GitHub connectivity probe for scheduler monitor repos. */
export async function fetchSchedulerValidation(): Promise<SchedulerValidationResponse> {
  const response = await fetch(SCHEDULER_VALIDATE_ENDPOINT);
  assertSuccessfulResponse(response, 'scheduler validation fetch failed');
  return parseJsonResponse<SchedulerValidationResponse>(response);
}

/** Fetches detailed GitHub debug info including auth header format and connectivity probe results. */
export async function fetchGitHubDebugInfo(): Promise<GitHubDebugResponse> {
  const response = await fetch(SCHEDULER_GITHUB_DEBUG_ENDPOINT);
  assertSuccessfulResponse(response, 'github debug fetch failed');
  return parseJsonResponse<GitHubDebugResponse>(response);
}

