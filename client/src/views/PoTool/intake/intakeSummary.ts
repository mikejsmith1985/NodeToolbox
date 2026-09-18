// intakeSummary.ts — Builds the final summary table of a Guided Epic Intake: what happened to every item, in
// plain language a PO can paste into an email or a Confluence page (spec 037, contracts/summary-and-store.md).
//
// Pure and read-only: it never settles a decision, it only reads the ones already settled (or still open) and
// turns them into one row per item plus a renderable Markdown/HTML table.

import { buildJiraBrowseUrl } from '../../../utils/jiraBrowseUrl.ts';
import { listOpenDecisions } from './intakeChecklist.ts';
import {
  readItemDisplayTitle,
  readSettledValue,
  type AreaSize,
  type EpicIntake,
  type IntakeItem,
  type ItemKind,
  type SummaryAction,
  type SummaryRow,
} from './epicIntakeModel.ts';

// ── Constants ──

/** The two areas that own scope; every other stated area is shown as written, never canonicalised. */
const CANONICAL_AREA_DISPLAY_NAMES: Record<'enrollment' | 'fulfillment', string> = {
  enrollment: 'Enrollment',
  fulfillment: 'Fulfillment',
};

/** Human labels for a row's action, used by both the Markdown and HTML renderers so they never disagree. */
export const SUMMARY_ACTION_LABELS: Record<SummaryAction, string> = {
  existing: 'Existing',
  created: 'Created',
  skippedFulfillment: 'Skipped — Fulfillment-owned',
  notActionable: 'Not actionable',
  declined: 'Declined',
  failed: 'Failed',
  open: 'Open',
};

/** The step names shown in an "Open" row's reason, in the order a PO reads them. */
const STEP_DISPLAY_NAMES: Record<string, string> = {
  sortNotes: 'sorting the notes',
  decideOwners: 'deciding owners',
  checkDenp: 'checking DENP',
  match: 'matching to an existing Epic',
  confirmLabels: 'confirming the label',
  draft: 'reviewing the draft',
  create: 'creating the Epic',
  summary: 'the summary',
};

/** Kinds whose settled value keeps an item out of the work group ("Also in the notes"). */
const NON_WORK_KINDS: readonly ItemKind[] = ['risk', 'personAction', 'deferred', 'noise'];

// ── Row grouping ──

/**
 * Splits an intake's items into the visible work table and the collapsed "Also in the notes" group, in source
 * order. An item still open (kind not yet settled, or settled to `work`) is a work row; a settled non-work kind
 * is an "other" row. Nothing from `items` is ever dropped (set-aside lines are not items and never appear here).
 */
export function buildSummaryRows(
  intake: EpicIntake,
  jiraBaseUrl: string,
): { workRows: SummaryRow[]; otherRows: SummaryRow[] } {
  const openDecisionsByItemId = groupOpenDecisionsByItemId(intake);
  const workRows: SummaryRow[] = [];
  const otherRows: SummaryRow[] = [];
  for (const item of intake.items) {
    const settledKind = readSettledValue(item.decisions.kind);
    const row = buildSummaryRow(item, jiraBaseUrl, openDecisionsByItemId.get(item.id) ?? []);
    if (settledKind !== null && NON_WORK_KINDS.includes(settledKind)) {
      otherRows.push(row);
    } else {
      workRows.push(row);
    }
  }
  return { workRows, otherRows };
}

/** Every item's open decision steps, keyed by item id, so row derivation never re-runs the checklist per item. */
function groupOpenDecisionsByItemId(intake: EpicIntake): Map<string, string[]> {
  // isAiUnlocked is irrelevant here — only whether an item has anything open matters, not whose turn it is.
  const openDecisions = listOpenDecisions(intake, false);
  const stepsByItemId = new Map<string, string[]>();
  for (const openDecision of openDecisions) {
    if (openDecision.itemId === null) {
      continue;
    }
    const steps = stepsByItemId.get(openDecision.itemId) ?? [];
    steps.push(openDecision.step);
    stepsByItemId.set(openDecision.itemId, steps);
  }
  return stepsByItemId;
}

/** Builds one row's action, key and reason by trying each rule in the contract's precedence order. */
function buildSummaryRow(item: IntakeItem, jiraBaseUrl: string, openSteps: readonly string[]): SummaryRow {
  const outcome = deriveSummaryOutcome(item, openSteps);
  return {
    itemId: item.id,
    itemTitle: readItemDisplayTitle(item),
    kind: readSettledValue(item.decisions.kind),
    owner: readSettledValue(item.decisions.owner),
    action: outcome.action,
    jiraKey: outcome.key,
    jiraUrl: outcome.key ? buildJiraBrowseUrl(outcome.key, jiraBaseUrl) : null,
    label: outcome.action === 'created' ? readSettledValue(item.decisions.label) : null,
    statedSizes: formatStatedSizes(item.areaSizes),
    reason: outcome.reason,
  };
}

interface SummaryOutcome {
  action: SummaryAction;
  key: string | null;
  reason: string;
}

/** The action table from the contract, first match wins. Never returns a key alongside `open`. */
function deriveSummaryOutcome(item: IntakeItem, openSteps: readonly string[]): SummaryOutcome {
  if (openSteps.length > 0) {
    return { action: 'open', key: null, reason: `Waiting on: ${describeOpenStep(openSteps[0])}` };
  }

  const kindDecision = item.decisions.kind;
  const settledKind = readSettledValue(kindDecision);
  if (settledKind !== null && NON_WORK_KINDS.includes(settledKind) && kindDecision.state === 'settled') {
    return { action: 'notActionable', key: null, reason: kindDecision.reason };
  }

  const ownerDecision = item.decisions.owner;
  if (ownerDecision.state === 'settled' && ownerDecision.value === 'fulfillment') {
    return { action: 'skippedFulfillment', key: null, reason: ownerDecision.reason };
  }
  if (ownerDecision.state === 'settled' && ownerDecision.value === 'notActionable') {
    return { action: 'notActionable', key: null, reason: ownerDecision.reason };
  }

  const duplicateDecision = item.decisions.duplicate;
  if (duplicateDecision.state === 'settled' && duplicateDecision.value.verdict === 'notActionable') {
    return { action: 'notActionable', key: null, reason: duplicateDecision.reason };
  }
  if (duplicateDecision.state === 'settled' && duplicateDecision.value.verdict === 'existing') {
    return { action: 'existing', key: duplicateDecision.value.key, reason: duplicateDecision.reason };
  }

  const draftAcceptedDecision = item.decisions.draftAccepted;
  if (draftAcceptedDecision.state === 'settled' && draftAcceptedDecision.value === 'declined') {
    return { action: 'declined', key: null, reason: 'Declined at review' };
  }

  if (item.creation.state === 'failed') {
    return { action: 'failed', key: null, reason: item.creation.reason };
  }
  if (item.creation.state === 'created') {
    return { action: 'created', key: item.creation.key, reason: '' };
  }

  // Nothing open and no rule matched — the item has no reportable state yet (e.g. a brand-new item).
  return { action: 'open', key: null, reason: 'Waiting on: sorting the notes' };
}

function describeOpenStep(step: string): string {
  return STEP_DISPLAY_NAMES[step] ?? step;
}

// ── Stated sizes ──

/** The display name for an area: the canonical name for the two owning areas, else exactly as written. */
function formatAreaName(areaSize: AreaSize): string {
  if (areaSize.canonicalArea !== null) {
    return CANONICAL_AREA_DISPLAY_NAMES[areaSize.canonicalArea];
  }
  return areaSize.area;
}

/**
 * Renders every stated size in source order, e.g. "Enrollment XL (1.2M) · Fulfillment M · Infra XL · Facets M".
 * Empty when the item has no stated sizes at all (FR-023 — sizes appear only here).
 */
export function formatStatedSizes(areaSizes: readonly AreaSize[]): string {
  return areaSizes
    .map((areaSize) => {
      const costSuffix = areaSize.cost ? ` (${areaSize.cost})` : '';
      return `${formatAreaName(areaSize)} ${areaSize.size}${costSuffix}`;
    })
    .join(' · ');
}

// ── Rendering ──

const SUMMARY_COLUMN_HEADERS = ['Item', 'Owner', 'Action', 'Jira key', 'Label', 'Stated sizes', 'Reason'] as const;

/** '—' for a field with no value, matching the rest of the tool's empty-cell convention. */
function displayOrDash(value: string | null): string {
  return value && value.trim() !== '' ? value : '—';
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** One row's cell values in column order, before either renderer escapes them. */
function buildRowCells(row: SummaryRow): string[] {
  return [
    row.itemTitle,
    displayOrDash(row.owner),
    SUMMARY_ACTION_LABELS[row.action],
    displayOrDash(row.jiraKey),
    displayOrDash(row.label),
    displayOrDash(row.statedSizes),
    displayOrDash(row.reason),
  ];
}

/** Renders the summary as a pipe-delimited Markdown table — the plain-text half of the copy payload. */
export function renderSummaryMarkdown(rows: readonly SummaryRow[]): string {
  const headerLine = `| ${SUMMARY_COLUMN_HEADERS.join(' | ')} |`;
  const dividerLine = `| ${SUMMARY_COLUMN_HEADERS.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((row) => `| ${buildRowCells(row).map(escapeMarkdownCell).join(' | ')} |`);
  return [headerLine, dividerLine, ...bodyLines].join('\n');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const HTML_CELL_STYLE = 'border: 1px solid #ccc; padding: 4px 8px; text-align: left;';

function renderHtmlCell(value: string, isHeader: boolean): string {
  const tag = isHeader ? 'th' : 'td';
  return `<${tag} style="${HTML_CELL_STYLE}">${escapeHtml(value)}</${tag}>`;
}

/** Renders the Jira key cell as a link when the row has one, else plain dashed text. */
function renderJiraKeyCell(row: SummaryRow): string {
  if (row.jiraKey === null || row.jiraUrl === null) {
    return renderHtmlCell('—', false);
  }
  return `<td style="${HTML_CELL_STYLE}"><a href="${escapeHtml(row.jiraUrl)}">${escapeHtml(row.jiraKey)}</a></td>`;
}

/**
 * Renders the summary as a plain inline-styled `<table>` (no classes) so it survives being pasted into Outlook,
 * Teams or Confluence — the HTML half of the copy payload.
 */
export function renderSummaryHtml(rows: readonly SummaryRow[]): string {
  const headerRow = `<tr>${SUMMARY_COLUMN_HEADERS.map((header) => renderHtmlCell(header, true)).join('')}</tr>`;
  const bodyRows = rows.map((row) => {
    const cells = buildRowCells(row);
    const [itemCell, ownerCell, actionCell, , labelCell, sizesCell, reasonCell] = cells;
    return `<tr>${renderHtmlCell(itemCell, false)}${renderHtmlCell(ownerCell, false)}${renderHtmlCell(actionCell, false)}${renderJiraKeyCell(row)}${renderHtmlCell(labelCell, false)}${renderHtmlCell(sizesCell, false)}${renderHtmlCell(reasonCell, false)}</tr>`;
  });
  return `<table style="border-collapse: collapse;">${headerRow}${bodyRows.join('')}</table>`;
}

// ── Clipboard ──

/**
 * Puts the table on the clipboard as HTML (so email, Teams and Confluence paste a real table) and as Markdown (for
 * plain-text targets). Falls back to plain text where the browser cannot write rich clipboard content.
 */
export async function copySummaryTable(rows: readonly SummaryRow[]): Promise<void> {
  const markdown = renderSummaryMarkdown(rows);
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
    await navigator.clipboard.writeText(markdown);
    return;
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([renderSummaryHtml(rows)], { type: 'text/html' }),
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
    }),
  ]);
}
