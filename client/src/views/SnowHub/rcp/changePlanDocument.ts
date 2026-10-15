// changePlanDocument.ts — The change plan PDF the RCP approval email says is attached (GH #441).
//
// Change Management's approval template asks the Director to "review the attached PDF" holding the
// implementation plan, risk and impact analysis, backout plan and testing. Two ways to get it:
//  1. ServiceNow's own form export (`change_request.do?PDF&sys_id=…`) — the framework already makes a PDF of a
//     record, so that is the first choice. It does not carry the change's tasks.
//  2. A print-ready plan built here from the change and its tasks, opened in a new window for the browser's
//     own "Save as PDF". Drift justification: no PDF library ships with Toolbox and none is needed — every
//     supported browser already prints to PDF, and the window title becomes the suggested file name.
// Empty sections print as "Not provided in ServiceNow." so a gap is seen before the email goes out.

import { snowFetch } from '../../../services/snowApi.ts';
import { fetchChangeTaskRecords } from '../chgFormula/ctaskReviewApi.ts';
import { readReviewedCtask } from '../chgFormula/ctaskReviewRecord.ts';
import { extractStringValue } from '../hooks/useCrgState.ts';
import { readUtcInstant, type RcpChangeFacts } from './rcpChangeFacts.ts';
import { describeCentralWindow } from './rcpRules.ts';

/** One change task as the plan shows it. */
export interface ChangePlanTask {
  number: string;
  shortDescription: string;
  typeLabel: string;
  assignmentGroupName: string;
  assignedToName: string;
  configItemName: string;
  /** The task's planned window in Central Time, or '' when it has none. */
  windowText: string;
  description: string;
}

/** Everything the printed change plan holds. */
export interface ChangePlan {
  changeNumber: string;
  shortDescription: string;
  environmentLabel: string;
  riskLabel: string;
  impactLabel: string;
  configItemName: string;
  ciOwnerName: string;
  requestedByName: string;
  assignmentGroupName: string;
  /** The change's planned window in Central Time, or '' when it has none. */
  windowText: string;
  description: string;
  justification: string;
  implementationPlan: string;
  riskImpactAnalysis: string;
  backoutPlan: string;
  testPlan: string;
  tasks: ChangePlanTask[];
}

// The plan text the RCP facts do not already carry. Impact is read under both names instances use.
const CHANGE_PLAN_FIELDS = [
  'description', 'implementation_plan', 'risk_impact_analysis', 'test_plan', 'impact', 'u_impact', 'assignment_group',
].join(',');
const EMPTY_SECTION_TEXT = 'Not provided in ServiceNow.';
const NO_TASKS_TEXT = 'No change tasks on this change.';
const CHANGE_FORM_PATH = 'change_request.do';

// ── ServiceNow's own PDF ──

/** ServiceNow's own PDF export of the change form, or null when the ServiceNow address or the change is unknown. */
export function buildServiceNowChangePdfUrl(snowBaseUrl: string | null, changeSysId: string): string | null {
  const normalizedBaseUrl = (snowBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (normalizedBaseUrl === '' || changeSysId.trim() === '') {
    return null;
  }
  return `${normalizedBaseUrl}/${CHANGE_FORM_PATH}?PDF&sys_id=${encodeURIComponent(changeSysId.trim())}`;
}

// ── Reading the plan ──

/** One change task record as the plan shows it. */
function readChangePlanTask(taskRecord: Record<string, unknown>): ChangePlanTask {
  const reviewedTask = readReviewedCtask(taskRecord);
  return {
    number: reviewedTask.number,
    shortDescription: reviewedTask.shortDescription,
    typeLabel: reviewedTask.typeLabel,
    assignmentGroupName: reviewedTask.assignmentGroup.displayName,
    assignedToName: reviewedTask.assignedTo.displayName,
    configItemName: reviewedTask.configItem.displayName,
    windowText: describeCentralWindow(readUtcInstant(taskRecord.planned_start_date), readUtcInstant(taskRecord.planned_end_date)),
    description: reviewedTask.description,
  };
}

/** The change's tasks for the plan; an unreadable task list prints as "no tasks" rather than failing the plan. */
async function fetchChangePlanTasks(changeSysId: string): Promise<ChangePlanTask[]> {
  try {
    return (await fetchChangeTaskRecords(changeSysId)).map(readChangePlanTask);
  } catch {
    return [];
  }
}

/**
 * The full change plan: the facts the RCP check already read, plus the plan text and the change's tasks,
 * read fresh from ServiceNow so the PDF matches what Change Management will see.
 */
export async function fetchChangePlan(facts: RcpChangeFacts): Promise<ChangePlan> {
  const [reply, tasks] = await Promise.all([
    snowFetch<{ result?: Record<string, unknown> }>(
      `/api/now/table/change_request/${facts.changeSysId}?sysparm_display_value=all&sysparm_fields=${CHANGE_PLAN_FIELDS}`,
      { method: 'GET' },
    ),
    fetchChangePlanTasks(facts.changeSysId),
  ]);
  const changeRecord = reply?.result ?? {};
  return {
    changeNumber: facts.changeNumber,
    shortDescription: facts.shortDescription,
    environmentLabel: facts.environmentLabel,
    riskLabel: facts.riskLabel,
    impactLabel: extractStringValue(changeRecord.u_impact) || extractStringValue(changeRecord.impact),
    configItemName: facts.configItem.displayName,
    ciOwnerName: facts.ciOwner?.displayName ?? '',
    requestedByName: facts.requestedBy.displayName,
    assignmentGroupName: extractStringValue(changeRecord.assignment_group),
    windowText: describeCentralWindow(facts.plannedStartUtc, facts.plannedEndUtc),
    description: extractStringValue(changeRecord.description),
    justification: facts.justification,
    implementationPlan: extractStringValue(changeRecord.implementation_plan),
    riskImpactAnalysis: extractStringValue(changeRecord.risk_impact_analysis),
    backoutPlan: facts.backoutPlan,
    testPlan: extractStringValue(changeRecord.test_plan),
    tasks,
  };
}

// ── The printable document ──

/** Text made safe to place inside HTML, so ServiceNow text prints exactly as written. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A value for a summary cell, or a dash when ServiceNow holds none. */
function renderCellText(value: string): string {
  return value.trim() === '' ? '—' : escapeHtml(value.trim());
}

/** One titled section of long text, saying so plainly when it is empty. */
function renderTextSection(heading: string, sectionText: string): string {
  const bodyHtml = sectionText.trim() === ''
    ? `<p class="empty">${EMPTY_SECTION_TEXT}</p>`
    : `<div class="text">${escapeHtml(sectionText.trim())}</div>`;
  return `<section><h2>${escapeHtml(heading)}</h2>${bodyHtml}</section>`;
}

/** The change's summary table: what, where, when, who and how risky. */
function renderSummaryTable(plan: ChangePlan): string {
  const summaryRows: [string, string][] = [
    ['Change', `${plan.changeNumber} — ${plan.shortDescription}`],
    ['Environment', plan.environmentLabel],
    ['Configuration item', plan.configItemName],
    ['CI owner', plan.ciOwnerName],
    ['Requested by', plan.requestedByName],
    ['Assignment group', plan.assignmentGroupName],
    ['Planned window (Central Time)', plan.windowText],
    ['Risk', plan.riskLabel],
    ['Impact', plan.impactLabel],
  ];
  const rowsHtml = summaryRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${renderCellText(value)}</td></tr>`);
  return `<table class="summary">${rowsHtml.join('')}</table>`;
}

/** The change's tasks: a table of who does what when, then each task's own instructions. */
function renderTasksSection(tasks: readonly ChangePlanTask[]): string {
  if (tasks.length === 0) {
    return `<section><h2>Change tasks</h2><p class="empty">${NO_TASKS_TEXT}</p></section>`;
  }
  const headerHtml = '<tr><th>Task</th><th>Type</th><th>Summary</th><th>Group / assignee</th><th>CI</th><th>Window (CT)</th></tr>';
  const rowsHtml = tasks.map((task) => `<tr><td>${renderCellText(task.number)}</td><td>${renderCellText(task.typeLabel)}</td>`
    + `<td>${renderCellText(task.shortDescription)}</td>`
    + `<td>${renderCellText([task.assignmentGroupName, task.assignedToName].filter((name) => name.trim() !== '').join(' / '))}</td>`
    + `<td>${renderCellText(task.configItemName)}</td><td>${renderCellText(task.windowText)}</td></tr>`);
  const detailsHtml = tasks
    .filter((task) => task.description.trim() !== '')
    .map((task) => `<h3>${escapeHtml(`${task.number} — ${task.shortDescription}`)}</h3><div class="text">${escapeHtml(task.description.trim())}</div>`);
  return `<section><h2>Change tasks</h2><table class="tasks">${headerHtml}${rowsHtml.join('')}</table>${detailsHtml.join('')}</section>`;
}

// Print styling: plain, black on white, readable when printed or saved as PDF on letter paper.
const DOCUMENT_STYLES = [
  '@page { margin: 16mm; }',
  'body { font-family: Segoe UI, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; margin: 0; }',
  'h1 { font-size: 17pt; margin: 0 0 4px; } h2 { font-size: 13pt; border-bottom: 1px solid #999; margin: 18px 0 6px; }',
  'h3 { font-size: 11pt; margin: 12px 0 4px; } .meta { color: #555; font-size: 9pt; margin: 0 0 12px; }',
  'table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }',
  '.summary th { width: 30%; background: #f2f2f2; } .tasks th { background: #f2f2f2; } tr { page-break-inside: avoid; }',
  '.text { white-space: pre-wrap; } .empty { color: #8a5a00; font-style: italic; }',
].join('\n');

/**
 * The change plan as a self-contained, print-ready page. Its title is the PDF's suggested file name, and every
 * ServiceNow value is escaped so the printout shows the text exactly as it is stored.
 */
export function buildChangePlanDocumentHtml(plan: ChangePlan, generatedOnLabel: string): string {
  const documentTitle = `${plan.changeNumber} change plan`;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(documentTitle)}</title><style>${DOCUMENT_STYLES}</style></head><body>`,
    `<h1>${escapeHtml(`Change plan — ${plan.changeNumber}`)}</h1>`,
    `<p class="meta">${escapeHtml(`Read from ServiceNow on ${generatedOnLabel}.`)}</p>`,
    renderSummaryTable(plan),
    renderTextSection('Description', plan.description),
    renderTextSection('Justification', plan.justification),
    renderTextSection('Implementation plan', plan.implementationPlan),
    renderTextSection('Risk and impact analysis', plan.riskImpactAnalysis),
    renderTextSection('Backout plan', plan.backoutPlan),
    renderTextSection('Pre-production and post-implementation testing', plan.testPlan),
    renderTasksSection(plan.tasks),
    '</body></html>',
  ].join('');
}

/** Opens a window the browser lets the page write into; null when a pop-up blocker stops it. */
type OpenPrintWindow = () => Window | null;

/**
 * Writes the plan into a new window and opens the browser's print dialog, where "Save as PDF" makes the
 * attachment. False when the pop-up was blocked, so the caller can say so rather than appear to do nothing.
 */
export function openChangePlanForPrinting(
  documentHtml: string,
  openPrintWindow: OpenPrintWindow = () => window.open('', '_blank'),
): boolean {
  const printWindow = openPrintWindow();
  if (printWindow === null) {
    return false;
  }
  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}
