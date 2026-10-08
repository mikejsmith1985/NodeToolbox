// rcpRules.ts — The RCP rules every Production change must meet through 19 Jan 2027 (GH #415).
//
// Change Management's restricted change period adds five requirements to Production and Production-impacting
// changes: an approved window (Friday–Sunday nights only, never 5 AM–7 PM Central), the Director-level Service
// Owner as Requested By, that Director's email approval attached, a justification for changing during the
// period, and early submission for Moderate and High risk. Each rule here is pure and judges facts it is
// handed, so the same checklist serves a new change, an existing one, and a sweep of every in-flight change.

import { formatMinutes } from '../ctaskDurations.ts';
import type { SnowReference } from '../hooks/useCrgState.ts';

/** pass = meets the rule; fail = does not; check = a person must confirm what Toolbox cannot read. */
export type RcpCheckStatus = 'pass' | 'fail' | 'check';

/** One rule's verdict, in words a change owner can act on. */
export interface RcpCheckResult {
  ruleId: 'window' | 'director' | 'approval' | 'justification' | 'leadTime';
  title: string;
  status: RcpCheckStatus;
  detail: string;
}

/** The last day the RCP rules apply. */
export const RCP_LAST_DAY_ISO = '2027-01-19';
const CENTRAL_TIME_ZONE = 'America/Chicago';
// Implementation may only START on these nights (a night runs 7 PM to 5 AM the next morning).
const ALLOWED_NIGHT_WEEKDAYS = new Set(['Fri', 'Sat', 'Sun']);
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 5;
const MILLISECONDS_PER_MINUTE = 60_000;
const LEAD_TIME_BUSINESS_DAYS = 3;
// Risk levels that need Change Management's extra review time.
const EARLY_SUBMISSION_RISK_PATTERN = /moderate|high/i;
const APPROVAL_FILE_PATTERN = /\.(msg|eml|pdf)$/i;
// What a justification must cover, each recognised by the words people use for it.
const JUSTIFICATION_PARTS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'why it must happen during RCP', pattern: /\brcp\b|restricted change|freeze|during (the )?(holiday|period)|cannot wait|must (be )?(deploy|implement|happen|occur)/i },
  { label: 'the impact of waiting until after Jan 19', pattern: /delay|after jan|until jan|postpon|wait(ing)?\b|defer/i },
  { label: 'the time-sensitive business or operational need', pattern: /deadline|time.?sensitive|urgent|regulat|complian|by (nov|dec|jan|oct)|member|customer|revenue|outage/i },
];

/** The Central Time calendar facts of one instant. */
interface CentralTimeParts {
  dateIso: string;
  weekday: string;
  hour: number;
  minute: number;
  label: string;
}

/** Reads an instant as Central Time: its calendar day, weekday, hour and a readable label. */
function readCentralTimeParts(instantIso: string): CentralTimeParts {
  const formattedParts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instantIso));
  const partValue = (partType: string) => formattedParts.find((part) => part.type === partType)?.value ?? '';
  const hour = Number(partValue('hour'));
  const minute = Number(partValue('minute'));
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return {
    dateIso: `${partValue('year')}-${partValue('month')}-${partValue('day')}`,
    weekday: partValue('weekday'),
    hour,
    minute,
    label: `${partValue('weekday')} ${displayHour}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`,
  };
}

/** A calendar day moved by a number of days. */
function shiftCalendarDay(dateIso: string, dayCount: number): string {
  const shiftedDate = new Date(`${dateIso}T00:00:00Z`);
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + dayCount);
  return shiftedDate.toISOString().slice(0, 10);
}

/** The weekday of a calendar day. */
function readWeekday(dateIso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${dateIso}T00:00:00Z`));
}

/** Why a planned window breaks the night rule, or null when it sits inside one allowed night. */
function findNightRuleBreach(start: CentralTimeParts, end: CentralTimeParts): string | null {
  const isStartAtNight = start.hour >= NIGHT_START_HOUR || start.hour < NIGHT_END_HOUR;
  if (!isStartAtNight) {
    return `It starts ${start.label} CT — no work is allowed between 5:00 AM and 7:00 PM CT.`;
  }
  const nightDateIso = start.hour >= NIGHT_START_HOUR ? start.dateIso : shiftCalendarDay(start.dateIso, -1);
  const nightWeekday = readWeekday(nightDateIso);
  if (!ALLOWED_NIGHT_WEEKDAYS.has(nightWeekday)) {
    return `It runs on ${nightWeekday} night — implementations are only allowed Friday, Saturday or Sunday night.`;
  }
  const isEndSameEvening = end.dateIso === nightDateIso && end.hour >= NIGHT_START_HOUR;
  const isEndNextMorning = end.dateIso === shiftCalendarDay(nightDateIso, 1)
    && (end.hour < NIGHT_END_HOUR || (end.hour === NIGHT_END_HOUR && end.minute === 0));
  return isEndSameEvening || isEndNextMorning ? null : `It ends ${end.label} CT — the window must close by 5:00 AM CT.`;
}

/**
 * Rule 1: the planned window sits inside one allowed night (starting Fri, Sat or Sun, 7 PM–5 AM CT), and
 * implementation, validation and backout together fit inside it.
 */
export function checkImplementationWindow(input: {
  plannedStartUtc: string | null;
  plannedEndUtc: string | null;
  totalEstimateMinutes: number | null;
}): RcpCheckResult {
  const title = 'Approved implementation window';
  if (!input.plannedStartUtc || !input.plannedEndUtc) {
    return { ruleId: 'window', title, status: 'fail', detail: 'The change has no planned start and end to check.' };
  }
  const start = readCentralTimeParts(input.plannedStartUtc);
  const end = readCentralTimeParts(input.plannedEndUtc);
  const windowMinutes = Math.round((Date.parse(input.plannedEndUtc) - Date.parse(input.plannedStartUtc)) / MILLISECONDS_PER_MINUTE);
  const windowText = `${start.label} → ${end.label} CT (${formatMinutes(Math.max(windowMinutes, 0))})`;
  const breach = windowMinutes <= 0 ? 'It ends before it starts.' : findNightRuleBreach(start, end);
  if (breach !== null) {
    return { ruleId: 'window', title, status: 'fail', detail: `${windowText}. ${breach}` };
  }
  if (input.totalEstimateMinutes === null) {
    return { ruleId: 'window', title, status: 'check', detail: `${windowText}. No duration estimates — confirm implementation, validation and backout all fit.` };
  }
  if (input.totalEstimateMinutes > windowMinutes) {
    return { ruleId: 'window', title, status: 'fail', detail: `${windowText}, but implementation, validation and backout need ${formatMinutes(input.totalEstimateMinutes)}.` };
  }
  return { ruleId: 'window', title, status: 'pass', detail: `${windowText}; implementation, validation and backout need ${formatMinutes(input.totalEstimateMinutes)}.` };
}

/** Rule 2: the Director-level Service Owner of the impacted CI is listed in Requested By. */
export function checkRequestedByIsDirector(requestedBy: SnowReference, ciOwner: SnowReference | null): RcpCheckResult {
  const title = 'Director listed as Requested By';
  if (!requestedBy.sysId && !requestedBy.displayName.trim()) {
    return { ruleId: 'director', title, status: 'fail', detail: 'Requested By is empty — list the CI\'s Director-level Service Owner.' };
  }
  if (ciOwner === null || (!ciOwner.sysId && !ciOwner.displayName.trim())) {
    return { ruleId: 'director', title, status: 'check', detail: `Requested By is ${requestedBy.displayName}. The CI's owner could not be read — confirm this is the Director-level Service Owner.` };
  }
  const isSamePerson = requestedBy.sysId && ciOwner.sysId
    ? requestedBy.sysId === ciOwner.sysId
    : requestedBy.displayName.trim().toLowerCase() === ciOwner.displayName.trim().toLowerCase();
  return isSamePerson
    ? { ruleId: 'director', title, status: 'pass', detail: `Requested By is ${requestedBy.displayName}, the CI's owner.` }
    : { ruleId: 'director', title, status: 'check', detail: `Requested By is ${requestedBy.displayName}, but the CI's owner is ${ciOwner.displayName} — confirm which is the Director-level Service Owner.` };
}

/** Rule 3: the Director's email approval is attached (an .msg, .eml or .pdf file). */
export function checkApprovalAttached(attachmentFileNames: readonly string[] | null): RcpCheckResult {
  const title = 'Director approval attached';
  if (attachmentFileNames === null) {
    return { ruleId: 'approval', title, status: 'check', detail: 'The change\'s attachments could not be read — confirm the Director\'s approval email is attached.' };
  }
  const approvalFiles = attachmentFileNames.filter((fileName) => APPROVAL_FILE_PATTERN.test(fileName.trim()));
  return approvalFiles.length > 0
    ? { ruleId: 'approval', title, status: 'pass', detail: `Attached: ${approvalFiles.join(', ')}.` }
    : { ruleId: 'approval', title, status: 'fail', detail: 'No email (.msg / .eml) or PDF is attached — attach the Director\'s approval email.' };
}

/** Rule 4: the justification covers why now, the impact of waiting, and the time-sensitive need. */
export function checkJustification(justification: string): RcpCheckResult {
  const title = 'Justification for changing during RCP';
  if (justification.trim() === '') {
    return { ruleId: 'justification', title, status: 'fail', detail: 'The justification is empty.' };
  }
  const missingParts = JUSTIFICATION_PARTS.filter((part) => !part.pattern.test(justification)).map((part) => part.label);
  return missingParts.length === 0
    ? { ruleId: 'justification', title, status: 'pass', detail: 'It covers why now, the impact of waiting, and the time-sensitive need.' }
    : { ruleId: 'justification', title, status: 'check', detail: `Make sure it explains ${missingParts.join('; ')}.` };
}

/** Weekdays strictly between two calendar days — the business days Change Management has to review. */
function countBusinessDaysBetween(fromDateIso: string, toDateIso: string): number {
  let businessDayCount = 0;
  for (let dayIso = shiftCalendarDay(fromDateIso, 1); dayIso < toDateIso; dayIso = shiftCalendarDay(dayIso, 1)) {
    if (!['Sat', 'Sun'].includes(readWeekday(dayIso))) businessDayCount += 1;
  }
  return businessDayCount;
}

/** Rule 5: a Moderate or High risk change is submitted at least three business days before it starts. */
export function checkLeadTime(input: { riskLabel: string; todayIso: string; plannedStartUtc: string | null }): RcpCheckResult {
  const title = 'Submitted early enough';
  if (input.riskLabel.trim() === '') {
    return { ruleId: 'leadTime', title, status: 'check', detail: `Risk is not set yet — Moderate and High risk changes need ${LEAD_TIME_BUSINESS_DAYS} business days of review.` };
  }
  if (!EARLY_SUBMISSION_RISK_PATTERN.test(input.riskLabel)) {
    return { ruleId: 'leadTime', title, status: 'pass', detail: `${input.riskLabel} risk — no extra review time required.` };
  }
  if (!input.plannedStartUtc) {
    return { ruleId: 'leadTime', title, status: 'fail', detail: 'The change has no planned start to measure the review time against.' };
  }
  const businessDays = countBusinessDaysBetween(input.todayIso, readCentralTimeParts(input.plannedStartUtc).dateIso);
  return businessDays >= LEAD_TIME_BUSINESS_DAYS
    ? { ruleId: 'leadTime', title, status: 'pass', detail: `${input.riskLabel} risk with ${businessDays} business days of review before it starts.` }
    : { ruleId: 'leadTime', title, status: 'fail', detail: `${input.riskLabel} risk with only ${businessDays} business days before it starts — ${LEAD_TIME_BUSINESS_DAYS} are needed.` };
}

/** A planned window in Central Time with its dates — "Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT". */
export function describeCentralWindow(plannedStartUtc: string | null, plannedEndUtc: string | null): string {
  if (!plannedStartUtc || !plannedEndUtc) {
    return '';
  }
  const describeInstant = (instantIso: string) => {
    const centralParts = readCentralTimeParts(instantIso);
    const [weekday, ...timeParts] = centralParts.label.split(' ');
    return `${weekday} ${centralParts.dateIso} ${timeParts.join(' ')}`;
  };
  return `${describeInstant(plannedStartUtc)} → ${describeInstant(plannedEndUtc)} CT`;
}

/** True while the RCP rules apply: switched on, and on or before their last day. */
export function isRcpPeriodActive(isEnabled: boolean, todayIso: string): boolean {
  return isEnabled && todayIso <= RCP_LAST_DAY_ISO;
}

/** Today's calendar day in Central Time, the day the rules are judged on. */
export function readCentralTodayIso(now: Date = new Date()): string {
  return readCentralTimeParts(now.toISOString()).dateIso;
}
