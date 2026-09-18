// intakeSummary.test.ts — Contract tests for the summary table (spec 037, contracts/summary-and-store.md §1):
// row grouping, the action derivation table (first match wins), stated-size formatting, and both renderers.

import { describe, expect, it } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type AreaSize,
  type Decision,
  type EpicIntake,
  type IntakeItem,
} from './epicIntakeModel.ts';
import {
  buildSummaryRows,
  formatStatedSizes,
  renderSummaryHtml,
  renderSummaryMarkdown,
  SUMMARY_ACTION_LABELS,
} from './intakeSummary.ts';

const JIRA_BASE_URL = 'https://jira.example.com';

// ── Builders ──

function settled<TValue>(value: TValue, reason = 'test reason', settledBy: 'rule' | 'ai' | 'po' = 'rule'): Decision<TValue> {
  return { state: 'settled', value, settledBy, reason, aiAttempts: 0 };
}

function buildIntake(items: IntakeItem[]): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: '2026-09-18T00:00:00.000Z',
    updatedAtIso: '2026-09-18T00:00:00.000Z',
    sourceTitles: ['Pasted notes'],
    lines: items.map((item) => ({ lineNumber: item.lineNumbers[0], text: item.title, rawText: item.title, outlineLevel: 1 })),
    items,
    setAsideLines: [],
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

/** A fresh, freshly-sorted work item: kind = work, everything else still open. */
function buildWorkItem(itemNumber: number, title = `Item ${itemNumber}`): IntakeItem {
  const item = createIntakeItem(itemNumber, title, [itemNumber]);
  item.decisions.kind = settled('work', 'Looks like work');
  return item;
}

// ── Row grouping ──

describe('buildSummaryRows — grouping', () => {
  it('puts a still-open item in workRows (kind not yet settled)', () => {
    const item = createIntakeItem(1, 'Undecided item', [1]);
    const { workRows, otherRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows.map((row) => row.itemId)).toEqual(['item-1']);
    expect(otherRows).toEqual([]);
  });

  it('puts a settled work item in workRows', () => {
    const item = buildWorkItem(1);
    const { workRows, otherRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows.map((row) => row.itemId)).toEqual(['item-1']);
    expect(otherRows).toEqual([]);
  });

  it('puts a settled non-work kind in otherRows ("Also in the notes")', () => {
    const item = createIntakeItem(1, 'A risk', [1]);
    item.decisions.kind = settled('risk', 'Mentions a blocker');
    const { workRows, otherRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows).toEqual([]);
    expect(otherRows.map((row) => row.itemId)).toEqual(['item-1']);
  });

  it('keeps source order across both groups', () => {
    const work = buildWorkItem(1, 'First');
    const noise = createIntakeItem(2, 'Second', [2]);
    noise.decisions.kind = settled('noise', 'Off-topic');
    const work2 = buildWorkItem(3, 'Third');
    const { workRows, otherRows } = buildSummaryRows(buildIntake([work, noise, work2]), JIRA_BASE_URL);
    expect(workRows.map((row) => row.itemId)).toEqual(['item-1', 'item-3']);
    expect(otherRows.map((row) => row.itemId)).toEqual(['item-2']);
  });
});

// ── Action derivation ──

describe('buildSummaryRows — action derivation (first match wins)', () => {
  it('open: an item with any open decision reports "Waiting on: <step>" and no key', () => {
    const item = createIntakeItem(1, 'Fresh item', [1]);
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('open');
    expect(workRows[0].jiraKey).toBeNull();
    expect(workRows[0].reason).toMatch(/^Waiting on: /);
  });

  it('notActionable: settled non-work kind reports the kind reason', () => {
    const item = createIntakeItem(1, 'A person action', [1]);
    item.decisions.kind = settled('personAction', 'Someone needs to follow up');
    const { otherRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(otherRows[0].action).toBe('notActionable');
    expect(otherRows[0].reason).toBe('Someone needs to follow up');
    expect(otherRows[0].jiraKey).toBeNull();
  });

  it('skippedFulfillment: owner = fulfillment reports the owner reason', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('fulfillment', 'Stated size names Fulfillment only');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('skippedFulfillment');
    expect(workRows[0].reason).toBe('Stated size names Fulfillment only');
    expect(workRows[0].jiraKey).toBeNull();
  });

  it('notActionable: owner = notActionable reports the owner reason', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('notActionable', 'No clear owner');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('notActionable');
    expect(workRows[0].reason).toBe('No clear owner');
  });

  it('notActionable: duplicate verdict notActionable reports the duplicate reason', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('enrollment', 'Stated size names Enrollment');
    item.decisions.searchTerms = settled(['keyword'], 'Derived from title');
    item.decisions.duplicate = settled({ verdict: 'notActionable' }, 'Already covered informally');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('notActionable');
    expect(workRows[0].reason).toBe('Already covered informally');
    expect(workRows[0].jiraKey).toBeNull();
  });

  it('existing: duplicate verdict existing reports the matched key and reason', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('enrollment', 'Stated size names Enrollment');
    item.decisions.searchTerms = settled(['keyword'], 'Derived from title');
    item.decisions.duplicate = settled({ verdict: 'existing', key: 'DENP-500' }, 'Matched an open Epic');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('existing');
    expect(workRows[0].jiraKey).toBe('DENP-500');
    expect(workRows[0].jiraUrl).toBe('https://jira.example.com/browse/DENP-500');
    expect(workRows[0].reason).toBe('Matched an open Epic');
  });

  it('declined: draftAccepted = declined reports the fixed reason', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('enrollment', 'Stated size names Enrollment');
    item.decisions.searchTerms = settled(['keyword'], 'Derived from title');
    item.decisions.duplicate = settled({ verdict: 'createNew' }, 'No candidates');
    item.decisions.label = settled('Roadmap', 'PO chose Roadmap', 'po');
    item.decisions.draftAccepted = settled('declined', 'PO declined', 'po');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('declined');
    expect(workRows[0].reason).toBe('Declined at review');
    expect(workRows[0].jiraKey).toBeNull();
  });

  it('failed: creation failed reports Jira\'s reason', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('enrollment', 'Stated size names Enrollment');
    item.decisions.searchTerms = settled(['keyword'], 'Derived from title');
    item.decisions.duplicate = settled({ verdict: 'createNew' }, 'No candidates');
    item.decisions.label = settled('Roadmap', 'PO chose Roadmap', 'po');
    item.decisions.draftAccepted = settled('accepted', 'PO accepted', 'po');
    item.creation = { state: 'failed', reason: 'Field "Epic Name" is required', failedAtIso: '2026-09-18T00:00:00.000Z' };
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('failed');
    expect(workRows[0].reason).toBe('Field "Epic Name" is required');
    expect(workRows[0].jiraKey).toBeNull();
  });

  it('created: creation created reports the new key and label', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('enrollment', 'Stated size names Enrollment');
    item.decisions.searchTerms = settled(['keyword'], 'Derived from title');
    item.decisions.duplicate = settled({ verdict: 'createNew' }, 'No candidates');
    item.decisions.label = settled('Stability', 'PO chose Stability', 'po');
    item.decisions.draftAccepted = settled('accepted', 'PO accepted', 'po');
    item.creation = { state: 'created', key: 'DENP-777', createdAtIso: '2026-09-18T00:00:00.000Z' };
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].action).toBe('created');
    expect(workRows[0].jiraKey).toBe('DENP-777');
    expect(workRows[0].jiraUrl).toBe('https://jira.example.com/browse/DENP-777');
    expect(workRows[0].label).toBe('Stability');
  });

  it('label is null for every non-created action', () => {
    const item = buildWorkItem(1);
    item.decisions.owner = settled('enrollment', 'Stated size names Enrollment');
    item.decisions.searchTerms = settled(['keyword'], 'Derived from title');
    item.decisions.duplicate = settled({ verdict: 'existing', key: 'DENP-1' }, 'Matched');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    expect(workRows[0].label).toBeNull();
  });

  it('invariant: never created or existing without a key, and never a key while open', () => {
    const openItem = createIntakeItem(1, 'Open', [1]);
    const existingItem = buildWorkItem(2);
    existingItem.decisions.owner = settled('enrollment', 'r');
    existingItem.decisions.searchTerms = settled(['keyword'], 'r');
    existingItem.decisions.duplicate = settled({ verdict: 'existing', key: 'DENP-9' }, 'r');
    const createdItem = buildWorkItem(3);
    createdItem.decisions.owner = settled('enrollment', 'r');
    createdItem.decisions.searchTerms = settled(['keyword'], 'r');
    createdItem.decisions.duplicate = settled({ verdict: 'createNew' }, 'r');
    createdItem.decisions.label = settled('Roadmap', 'r', 'po');
    createdItem.decisions.draftAccepted = settled('accepted', 'r', 'po');
    createdItem.creation = { state: 'created', key: 'DENP-10', createdAtIso: '2026-09-18T00:00:00.000Z' };

    const { workRows } = buildSummaryRows(buildIntake([openItem, existingItem, createdItem]), JIRA_BASE_URL);
    for (const row of workRows) {
      if (row.action === 'created' || row.action === 'existing') {
        expect(row.jiraKey).not.toBeNull();
      }
      if (row.action === 'open') {
        expect(row.jiraKey).toBeNull();
      }
    }
  });
});

// ── Stated sizes ──

describe('formatStatedSizes', () => {
  function areaSize(overrides: Partial<AreaSize>): AreaSize {
    return { area: 'Infra', canonicalArea: null, size: 'M', cost: null, lineNumber: 1, ...overrides };
  }

  it('returns empty string for no sizes', () => {
    expect(formatStatedSizes([])).toBe('');
  });

  it('formats the canonical names, order, and cost exactly as specified', () => {
    const sizes: AreaSize[] = [
      areaSize({ area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: '1.2M' }),
      areaSize({ area: 'Fulfilment', canonicalArea: 'fulfillment', size: 'M', cost: null }),
      areaSize({ area: 'Infra', canonicalArea: null, size: 'XL', cost: null }),
      areaSize({ area: 'Facets', canonicalArea: null, size: 'M', cost: null }),
    ];
    expect(formatStatedSizes(sizes)).toBe('Enrollment XL (1.2M) · Fulfillment M · Infra XL · Facets M');
  });

  it('keeps a non-owning area exactly as written', () => {
    expect(formatStatedSizes([areaSize({ area: 'Vendor', canonicalArea: null, size: 'S' })])).toBe('Vendor S');
  });
});

// ── Rendering ──

describe('renderSummaryMarkdown', () => {
  it('renders a pipe table with every column and escapes pipes in cells', () => {
    const item = buildWorkItem(1, 'Item with a | pipe');
    item.decisions.owner = settled('enrollment', 'r');
    item.decisions.searchTerms = settled(['keyword'], 'r');
    item.decisions.duplicate = settled({ verdict: 'existing', key: 'DENP-1' }, 'Matched | note');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    const markdown = renderSummaryMarkdown(workRows);
    expect(markdown).toContain('| Item | Owner | Action | Jira key | Label | Stated sizes | Reason |');
    expect(markdown).toContain('Item with a \\| pipe');
    expect(markdown).toContain(SUMMARY_ACTION_LABELS.existing);
    expect(markdown).toContain('Matched \\| note');
  });
});

describe('renderSummaryHtml', () => {
  it('renders a plain table with a linked key and escapes HTML-sensitive characters', () => {
    const item = buildWorkItem(1, 'Item <b>&"bold"</b>');
    item.decisions.owner = settled('enrollment', 'r');
    item.decisions.searchTerms = settled(['keyword'], 'r');
    item.decisions.duplicate = settled({ verdict: 'existing', key: 'DENP-2' }, 'r');
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    const html = renderSummaryHtml(workRows);
    expect(html).toContain('<table');
    expect(html).not.toContain('class=');
    expect(html).toContain('Item &lt;b&gt;&amp;&quot;bold&quot;&lt;/b&gt;');
    expect(html).toContain('<a href="https://jira.example.com/browse/DENP-2">DENP-2</a>');
  });

  it('renders a dash, not a link, when a row has no key', () => {
    const item = createIntakeItem(1, 'Open item', [1]);
    const { workRows } = buildSummaryRows(buildIntake([item]), JIRA_BASE_URL);
    const html = renderSummaryHtml(workRows);
    expect(html).not.toContain('<a href');
  });
});
