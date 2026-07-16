// monthlyDeliveryScheduler.js — Monthly Delivery Report scheduler (feature 018).
//
// Fires ONCE per calendar month — on the 2nd Tuesday at a configurable local time (default 08:00),
// with same-month catch-up when the server was off at the scheduled moment — and generates a single
// AI-ready prompt covering every configured team's prior-month deliveries. Mirrors the PI Review
// scheduler chassis (60-second tick, injectable tick options, schedulerFiredState persistence); the
// once-per-month semantics live entirely here via a YYYY-MM prefix compare on the stored fired date.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeJiraApiRequest } = require('../utils/httpClient');
const { isScheduledTimeReached, loadFiredDates, recordFiredDate } = require('./schedulerFiredState');
const reportLayer = require('./monthlyDeliveryReport');

// ── Constants ──

/** How often (ms) the scheduler checks whether the monthly fire is due. */
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

/** Stable name under which this scheduler's fired dates are persisted. */
const FIRED_STATE_SCHEDULER_NAME = 'monthlyDelivery';

/** The single fired-state config key: one report per month regardless of team count. */
const FIRED_STATE_CONFIG_KEY = 'monthlyDelivery';

/** Default fire time when the config has no scheduleTime set. */
const DEFAULT_SCHEDULE_TIME = '08:00';

/** Date.getDay() value for Tuesday. */
const DAY_TUESDAY = 2;

/** Days in one week — used to step from the first Tuesday of a month to the second. */
const DAYS_PER_WEEK = 7;

/** Length of a "YYYY-MM" month prefix inside a "YYYY-MM-DD" date string. */
const MONTH_PREFIX_LENGTH = 7;

// ── Pure date helpers (exported for unit tests) ──

/** Formats a Date as a local "YYYY-MM-DD" string. */
function formatLocalDate(date) {
  return date.getFullYear()
    + '-' + String(date.getMonth() + 1).padStart(2, '0')
    + '-' + String(date.getDate()).padStart(2, '0');
}

/**
 * Returns the 2nd Tuesday of the given month as a local "YYYY-MM-DD" string.
 * monthIndex is 0-based (0 = January), matching Date.
 */
function computeSecondTuesdayDate(year, monthIndex) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysUntilFirstTuesday = (DAY_TUESDAY - firstOfMonth.getDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const secondTuesdayDayOfMonth = 1 + daysUntilFirstTuesday + DAYS_PER_WEEK;
  return formatLocalDate(new Date(year, monthIndex, secondTuesdayDayOfMonth));
}

/**
 * Returns the calendar month BEFORE the given local date as "YYYY-MM" — the month a run covers.
 * A January run rolls back to December of the previous year.
 */
function resolveCoveredMonth(todayDateString) {
  const year = Number(todayDateString.slice(0, 4));
  const monthIndex = Number(todayDateString.slice(5, 7)) - 1;
  const firstOfPreviousMonth = new Date(year, monthIndex - 1, 1);
  return firstOfPreviousMonth.getFullYear() + '-' + String(firstOfPreviousMonth.getMonth() + 1).padStart(2, '0');
}

/**
 * Builds the attribution window for a covered month ("YYYY-MM"): local first instant of day 1
 * through the last millisecond of the final day, plus the first/last day date strings the Jira
 * JQL builder needs.
 */
function buildCoveredMonthWindow(coveredMonth) {
  const year = Number(coveredMonth.slice(0, 4));
  const monthIndex = Number(coveredMonth.slice(5, 7)) - 1;
  const firstDay = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const firstDayOfNextMonth = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
  const lastDay = new Date(firstDayOfNextMonth.getTime() - 1);
  return {
    coveredMonth,
    startMs: firstDay.getTime(),
    endMs: firstDayOfNextMonth.getTime() - 1,
    firstDayDate: formatLocalDate(firstDay),
    lastDayDate: formatLocalDate(lastDay),
  };
}

/**
 * Once-per-month guard: true when the stored fired date ("YYYY-MM-DD") falls inside the same
 * calendar month as today. The shared fired-state store is value-agnostic, so month semantics
 * live entirely in this compare.
 */
function hasAlreadyFiredThisMonth(storedFiredDate, todayDateString) {
  if (!storedFiredDate) {
    return false;
  }
  return storedFiredDate.slice(0, MONTH_PREFIX_LENGTH) === todayDateString.slice(0, MONTH_PREFIX_LENGTH);
}

// ── Last-run persistence (piReviewScheduler results-file pattern) ──

/** Path of the last-run results file; overridable via env so tests never touch the real profile. */
function getResultsFilePath() {
  return process.env.TBX_MONTHLY_DELIVERY_RESULTS_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'monthly-delivery-last-run.json');
}

/** Persists the whole RunResult (single slot — each run replaces the previous). */
function writeLastRunResult(runResult) {
  try {
    fs.mkdirSync(path.dirname(getResultsFilePath()), { recursive: true });
    fs.writeFileSync(getResultsFilePath(), JSON.stringify(runResult, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist Monthly Delivery run result: ' + writeError.message);
  }
}

/** Reads the persisted last RunResult; { hasRun: false } on any missing/corrupt file. */
function readLastRunResult() {
  try {
    return JSON.parse(fs.readFileSync(getResultsFilePath(), 'utf8'));
  } catch (_readError) {
    return { hasRun: false };
  }
}

// ── Run orchestration ──

/** Today's local date as "YYYY-MM-DD". */
function getTodayDateString() {
  const now = new Date();
  return formatLocalDate(now);
}

/** Overlap guard: true while a run (scheduled or manual) is in flight. */
let isRunInProgress = false;

/** Returns whether a run is currently in flight (the route uses this for its 409). */
function isMonthlyDeliveryRunInProgress() {
  return isRunInProgress;
}

/** Attaches the batch-fetched Feature summaries to each group (bare key remains the fallback). */
function applyFeatureSummaries(featureGroups, summariesByKey) {
  for (const featureGroup of featureGroups) {
    if (featureGroup.featureKey !== null) {
      featureGroup.featureSummary = summariesByKey.get(featureGroup.featureKey) || '';
    }
  }
}

/**
 * Builds one team's prompt section + outcome. Fetches candidates, classifies each issue against the
 * window, groups by Feature, and resolves Feature summaries. Throws on fetch failure — the caller
 * converts that into an honest per-team error.
 */
async function buildTeamSectionForRun(team, window, featureLinkFieldId, requestJira) {
  const teamData = await reportLayer.fetchTeamDeliveryData(team, window, featureLinkFieldId, { requestJira });

  const deliveryRecords = [];
  for (const issue of teamData.issues) {
    const classification = reportLayer.classifyIssueDelivery(issue, window, teamData.releasedVersionsInWindow);
    if (classification !== null) {
      deliveryRecords.push(reportLayer.buildDeliveryRecord(issue, classification, featureLinkFieldId));
    }
  }

  const productionRecords = deliveryRecords.filter((record) => record.bucket === reportLayer.PRODUCTION_BUCKET);
  const externalTestRecords = deliveryRecords.filter((record) => record.bucket === reportLayer.EXTERNAL_TEST_BUCKET);
  const productionGroups = reportLayer.groupRecordsByFeature(productionRecords);
  const externalTestGroups = reportLayer.groupRecordsByFeature(externalTestRecords);

  const featureKeys = Array.from(new Set(
    deliveryRecords.map((record) => record.featureKey).filter((featureKey) => featureKey !== null),
  ));
  const summariesByKey = await reportLayer.fetchFeatureSummaries(requestJira, featureKeys);
  applyFeatureSummaries(productionGroups, summariesByKey);
  applyFeatureSummaries(externalTestGroups, summariesByKey);

  const hasAnyRecords = deliveryRecords.length > 0;
  return {
    section: { teamName: team.teamName, status: hasAnyRecords ? 'ok' : 'empty', message: '', production: productionGroups, externalTest: externalTestGroups },
    outcome: {
      teamName: team.teamName,
      status: hasAnyRecords ? 'ok' : 'empty',
      productionCount: productionRecords.length,
      externalTestCount: externalTestRecords.length,
      message: '',
    },
  };
}

/** The per-team error fallback: an explicit DATA UNAVAILABLE section, never a fake clean one. */
function buildTeamErrorSection(team, errorMessage) {
  return {
    section: { teamName: team.teamName, status: 'error', message: errorMessage, production: [], externalTest: [] },
    outcome: { teamName: team.teamName, status: 'error', productionCount: 0, externalTestCount: 0, message: errorMessage },
  };
}

/**
 * Generates the Monthly Delivery Report immediately: classifies every snapshotted team's prior-month
 * work, builds the single all-teams prompt, and persists the RunResult. Injectable deps
 * (today/nowIso/requestJira/trigger) keep it unit-testable without a clock or Jira. A per-team
 * failure never aborts the run (FR-018); manual runs never touch the scheduler fired state (FR-003).
 */
async function runMonthlyDeliveryNow(configuration, deps = {}) {
  if (isRunInProgress) {
    return { ok: false, isAlreadyRunning: true, message: 'A Monthly Delivery run is already in progress.' };
  }
  const monthlyConfig = ((configuration.scheduler || {}).monthlyDelivery) || {};
  const teams = monthlyConfig.teams || [];
  if (teams.length === 0) {
    return { ok: false, message: 'No teams configured — snapshot teams and save first.' };
  }

  isRunInProgress = true;
  try {
    const todayDateString = deps.today || getTodayDateString();
    const ranAtIso = deps.nowIso ? deps.nowIso() : new Date().toISOString();
    const trigger = deps.trigger || 'manual';
    const coveredMonth = resolveCoveredMonth(todayDateString);
    const coveredWindow = buildCoveredMonthWindow(coveredMonth);
    const featureLinkFieldId = monthlyConfig.featureLinkFieldId || 'customfield_10108';
    const requestJira = deps.requestJira
      || ((requestPath) => makeJiraApiRequest('GET', requestPath, null, configuration.jira, configuration.sslVerify !== false));

    const teamSections = [];
    const teamOutcomes = [];
    for (const team of teams) {
      try {
        const teamResult = await buildTeamSectionForRun(team, coveredWindow, featureLinkFieldId, requestJira);
        teamSections.push(teamResult.section);
        teamOutcomes.push(teamResult.outcome);
      } catch (teamError) {
        const errorMessage = teamError instanceof Error ? teamError.message : String(teamError);
        const errorResult = buildTeamErrorSection(team, errorMessage);
        teamSections.push(errorResult.section);
        teamOutcomes.push(errorResult.outcome);
      }
    }

    const promptText = reportLayer.buildMonthlyDeliveryPrompt({ coveredMonth, ranAtIso, trigger }, teamSections);
    const runResult = { hasRun: true, ranAtIso, coveredMonth, trigger, promptText, teams: teamOutcomes };
    writeLastRunResult(runResult);
    return { ok: true, result: runResult };
  } finally {
    isRunInProgress = false;
  }
}

// ── Scheduled tick ──

/** Current local time as zero-padded "HH:MM". */
function getCurrentTimeHHMM() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

// In-memory fired dates, hydrated from the persistent fired-state file at scheduler start so a
// same-month restart never re-fires.
let moduleFiredDates = new Map();
let schedulerIntervalHandle = null;

/**
 * One scheduler tick: fires the monthly run when due. The fire rule (data-model.md state diagram):
 * enabled + teams configured + not fired this calendar month + today is ON the 2nd Tuesday at/after
 * the scheduled time, or PAST it (same-month catch-up after downtime, any time of day). A skip for
 * "no teams" or "run busy" never consumes the month — the tick simply retries. Every option is
 * injectable for tests (piReview DI pattern). Returns true when it fired.
 */
function checkAndFireMonthlyDelivery(configuration, options = {}) {
  const monthlyConfig = ((configuration.scheduler || {}).monthlyDelivery) || {};
  if (!monthlyConfig.isEnabled || (monthlyConfig.teams || []).length === 0) {
    return false;
  }

  const today = options.today || getTodayDateString();
  const currentTime = options.currentTime || getCurrentTimeHHMM();
  const firedDates = options.firedDates || moduleFiredDates;
  const recordFired = options.recordFired
    || ((configKey, dateString) => recordFiredDate(FIRED_STATE_SCHEDULER_NAME, configKey, dateString));
  const runReport = options.runReport
    || ((liveConfiguration) => runMonthlyDeliveryNow(liveConfiguration, { trigger: 'scheduled' }));
  const isRunBusy = options.isRunBusy || isMonthlyDeliveryRunInProgress;

  if (hasAlreadyFiredThisMonth(firedDates.get(FIRED_STATE_CONFIG_KEY), today)) {
    return false;
  }

  const secondTuesday = computeSecondTuesdayDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1);
  const scheduleTime = monthlyConfig.scheduleTime || DEFAULT_SCHEDULE_TIME;
  const isDueNow = today > secondTuesday
    || (today === secondTuesday && isScheduledTimeReached(scheduleTime, currentTime));
  if (!isDueNow || isRunBusy()) {
    return false;
  }

  firedDates.set(FIRED_STATE_CONFIG_KEY, today);
  recordFired(FIRED_STATE_CONFIG_KEY, today);
  Promise.resolve(runReport(configuration)).catch((runError) => {
    console.error('  ⚠ Monthly Delivery scheduled run failed: ' + (runError instanceof Error ? runError.message : String(runError)));
  });
  return true;
}

/**
 * Starts the Monthly Delivery scheduler: seeds fired state from disk, then ticks every 60 seconds
 * reading the live configuration reference. Returns a stop function.
 */
function startMonthlyDeliveryScheduler(configuration) {
  if (schedulerIntervalHandle !== null) {
    return () => {};
  }
  moduleFiredDates = loadFiredDates(FIRED_STATE_SCHEDULER_NAME);
  schedulerIntervalHandle = setInterval(() => checkAndFireMonthlyDelivery(configuration), SCHEDULE_CHECK_INTERVAL_MS);
  console.log('  📅 Monthly Delivery scheduler started (2nd Tuesday, 60s tick).');
  return function stopMonthlyDeliveryScheduler() {
    if (schedulerIntervalHandle !== null) {
      clearInterval(schedulerIntervalHandle);
      schedulerIntervalHandle = null;
    }
  };
}

module.exports = {
  FIRED_STATE_SCHEDULER_NAME,
  FIRED_STATE_CONFIG_KEY,
  DEFAULT_SCHEDULE_TIME,
  computeSecondTuesdayDate,
  resolveCoveredMonth,
  buildCoveredMonthWindow,
  hasAlreadyFiredThisMonth,
  runMonthlyDeliveryNow,
  isMonthlyDeliveryRunInProgress,
  readLastRunResult,
  checkAndFireMonthlyDelivery,
  startMonthlyDeliveryScheduler,
};
