// intakeAnnotatedNotes.test.ts — The original notes come back line for line with each item's Epic written beside it,
// ready to share (GH #387): new keys, existing keys, Shared scope, and why an item has no Epic.

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../sources/sourceModel.ts';
import type { Decision, EpicIntake, IntakeItem } from './epicIntakeModel.ts';
import { buildAnnotatedNotes } from './intakeAnnotatedNotes.ts';
import { startEpicIntake } from './startIntake.ts';

const JIRA_BASE_URL = 'https://jira.example.com';

const NOTES = [
  'Notes from OnSite',
  '•\tCore Integration (denp-632)',
  'o\tXL Enrollment',
  '•\tAEP',
  'o\tLarge for all',
  '•\tInvoice overhaul',
  'o\tFulfilment dev M',
].join('\n');

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'ai', reason: 'test', aiAttempts: 0 };
}

function findItem(intake: EpicIntake, titlePrefix: string): IntakeItem {
  const item = intake.items.find((candidate) => candidate.title.startsWith(titlePrefix));
  if (item === undefined) throw new Error(titlePrefix);
  return item;
}

/** GH #387 in miniature: Core matched an existing Epic, AEP created as Shared, Invoice is Fulfillment's. */
function buildFinishedIntake(): EpicIntake {
  const source: ReferencedSource = { kind: 'paste', id: 'p', label: 'Monday call', text: NOTES };
  const intake = startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: '2026-09-22T00:00:00.000Z', mintId: () => 'i' });
  const core = findItem(intake, 'Core');
  const aep = findItem(intake, 'AEP');
  const items = intake.items.map((item) => {
    if (item.id === core.id) {
      return { ...item, searchStatus: 'ok' as const, decisions: { ...item.decisions, kind: settled('work' as const), searchTerms: settled(['core']), duplicate: settled({ verdict: 'existing' as const, key: 'DENP-632' }), label: { state: 'notApplicable' as const, reason: 'x' }, draftAccepted: { state: 'notApplicable' as const, reason: 'x' } } };
    }
    if (item.id === aep.id) {
      return {
        ...item,
        searchStatus: 'ok' as const,
        draft: { summary: 'AEP (Enrollment scope)', description: 'D', source: 'ai' as const, editedByPo: false },
        creation: { state: 'created' as const, key: 'DENP-905', createdAtIso: '2026-09-22T00:00:00.000Z' },
        decisions: { ...item.decisions, kind: settled('work' as const), owner: settled('shared' as const), searchTerms: settled(['aep']), duplicate: settled({ verdict: 'createNew' as const }), label: settled('Roadmap' as const), draftAccepted: settled('accepted' as const) },
      };
    }
    return { ...item, decisions: { ...item.decisions, kind: settled('work' as const) } };
  });
  return { ...intake, items };
}

describe('buildAnnotatedNotes', () => {
  it('writes each item\'s Epic beside its own line, keeping bullets, tabs and order', () => {
    const { text } = buildAnnotatedNotes(buildFinishedIntake(), JIRA_BASE_URL);
    expect(text.split('\n')).toEqual([
      'Notes from OnSite',
      '•\tCore Integration (denp-632) — DENP-632 (existing Epic)',
      'o\tXL Enrollment',
      '•\tAEP — DENP-905 (new Epic, Enrollment scope)',
      'o\tLarge for all',
      '•\tInvoice overhaul — Fulfillment — no Enrollment Epic',
      'o\tFulfilment dev M',
    ]);
  });

  it('leaves out the source title Toolbox added, so only the PO\'s own notes are shared', () => {
    expect(buildAnnotatedNotes(buildFinishedIntake(), JIRA_BASE_URL).text).not.toContain('Monday call');
  });

  it('links the keys in the HTML copy and escapes everything else', () => {
    const { html } = buildAnnotatedNotes(buildFinishedIntake(), JIRA_BASE_URL);
    expect(html).toContain('<a href="https://jira.example.com/browse/DENP-905">DENP-905</a>');
    expect(html).toContain('<a href="https://jira.example.com/browse/DENP-632">DENP-632</a>');
    expect(html).toContain('•\tCore Integration (denp-632)');
  });

  it('says an item is not decided yet rather than inventing a key', () => {
    const source: ReferencedSource = { kind: 'paste', id: 'p', label: 'Notes', text: '•\tPaperless Options' };
    const intake = startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: '2026-09-22T00:00:00.000Z', mintId: () => 'i' });
    expect(buildAnnotatedNotes(intake, JIRA_BASE_URL).text).toBe('•\tPaperless Options — not decided yet');
  });
});
