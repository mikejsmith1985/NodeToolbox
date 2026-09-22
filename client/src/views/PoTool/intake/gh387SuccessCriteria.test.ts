// gh387SuccessCriteria.test.ts — Runs the real GH #387 notes through the whole engine with canned answers and checks
// the spec's measurable outcomes: every line accounted for, at most four exchanges (SC-001), few PO questions
// (SC-004), nothing Fulfillment-owned or deferred created (SC-003), and a key or reason for every row (SC-006).

import { describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import type { ReferencedSource } from '../sources/sourceModel.ts';
import { applyClassifyOutcome } from './ai/intakeClassifyApply.ts';
import { buildClassifyRequests, parseClassifyReply } from './ai/intakeClassifyRound.ts';
import { applyResolveOutcome, buildResolveRequests, parseResolveReply, RESOLVE_REPLY_KIND } from './ai/intakeResolveRound.ts';
import { runDuplicateSearch, type DuplicateSearchDeps } from './duplicateSearch.ts';
import { readItemDisplayTitle, readSettledValue, type EpicIntake, type IntakeItem } from './epicIntakeModel.ts';
import { GH387_NOTES_TEXT } from './gh387Notes.fixture.ts';
import { isEnrollmentOwned, isItemReadyToCreate, listOpenDecisions, readIntakeNextStep } from './intakeChecklist.ts';
import { acceptReviewedDrafts } from './intakePoAnswers.ts';
import { buildSummaryRows } from './intakeSummary.ts';
import { proveLineCoverage } from './notesOutline.ts';
import { startEpicIntake } from './startIntake.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

/** A plausible answer per title: most items are clear calls, one is a close call. */
function answerFor(title: string): Record<string, unknown> {
  const isRisk = /^risks$/i.test(title) || /capacity|consolidation/i.test(title);
  const isFulfillment = /letter|return mail|invoice|materials|paperless|id card|segment/i.test(title);
  const isCloseCall = /tech debt/i.test(title);
  return {
    kind: isRisk ? 'risk' : 'work',
    enrollmentShare: isCloseCall ? 50 : isFulfillment ? 20 : 80,
    searchTerms: [title.split(/[(\-–]/)[0].trim().split(/\s+/).slice(0, 3).join(' ') || title],
    labelProposal: /upgrade|debt|compliance|performance/i.test(title) ? 'Stability' : 'Roadmap',
    reason: 'canned',
  };
}

/** A resolve answer: the first Epic found when there is one, otherwise a new Epic with its label and draft. */
function resolveAnswerFor(item: IntakeItem): Record<string, unknown> {
  const firstCandidate = item.candidates[0];
  const verdict = firstCandidate === undefined ? { verdict: 'createNew' } : { verdict: 'existing', key: firstCandidate.key };
  return { id: item.id, ...verdict, confidence: 'high', reason: 'canned', label: 'Roadmap', summary: `Epic for ${item.id}`, description: 'Description:\nFrom the notes.' };
}

function buildOpenEpic(issueKey: string): JiraIssue {
  return {
    id: issueKey, key: issueKey,
    fields: { summary: 'Core Integration', issuetype: { name: 'Epic' }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
  } as unknown as JiraIssue;
}

const SEARCH_DEPS: DuplicateSearchDeps = {
  getProjectIssueTypes: vi.fn(async () => ({ values: [{ id: '10000', name: 'Epic', subtask: false }] })),
  searchIssues: vi.fn(async () => []),
  fetchIssueByKey: vi.fn(async (issueKey: string) => buildOpenEpic(issueKey)),
  extractHttpStatus: vi.fn(() => null),
};

function countPoQuestionsExceptLabels(intake: EpicIntake): number {
  return listOpenDecisions(intake, true).filter((openDecision) => openDecision.turn === 'po' && openDecision.slot !== 'label').length;
}

async function runGh387(): Promise<{ intake: EpicIntake; exchangeCount: number; poQuestionCount: number }> {
  const source: ReferencedSource = { kind: 'paste', id: 'p', label: 'Monday Product Call', text: GH387_NOTES_TEXT };
  let intake = startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: NOW_ISO, mintId: () => 'i' });
  let exchangeCount = 0;
  for (const request of buildClassifyRequests(intake)) {
    const items = request.itemIds.map((itemId) => ({ id: itemId, ...answerFor(readItemDisplayTitle(intake.items.find((item) => item.id === itemId)!)) }));
    const outcome = parseClassifyReply(JSON.stringify({ kind: 'epicIntakeClassify', items }), intake, request.itemIds);
    intake = applyClassifyOutcome(intake, outcome, request.itemIds, request, NOW_ISO);
    exchangeCount += 1;
  }
  const poQuestionCount = countPoQuestionsExceptLabels(intake);
  // The PO settles the one close call; everything else was decided by rule or answer.
  for (const item of intake.items.filter((candidate) => candidate.decisions.owner.state === 'open' && candidate.decisions.owner.isAwaitingPo)) {
    intake = { ...intake, items: intake.items.map((candidate) => (candidate.id === item.id ? { ...candidate, decisions: { ...candidate.decisions, owner: { state: 'settled', value: 'enrollment', settledBy: 'po', reason: 'PO', aiAttempts: 0 } } } : candidate)) };
  }
  intake = await runDuplicateSearch(intake, SEARCH_DEPS);
  // One resolve exchange (per part) answers every match, label and draft; the Create click then confirms them.
  for (const request of buildResolveRequests(intake)) {
    const items = request.itemIds.map((itemId) => resolveAnswerFor(intake.items.find((item) => item.id === itemId)!));
    const outcome = parseResolveReply(JSON.stringify({ kind: RESOLVE_REPLY_KIND, items }), intake, request.itemIds);
    intake = applyResolveOutcome(intake, outcome, request.itemIds, request, NOW_ISO);
    exchangeCount += 1;
  }
  intake = acceptReviewedDrafts(intake, true, NOW_ISO);
  return { intake, exchangeCount, poQuestionCount };
}

describe('GH #387 success criteria', () => {
  it('accounts for every line and reaches Create in at most four exchanges (SC-001)', async () => {
    const { intake, exchangeCount } = await runGh387();
    expect(proveLineCoverage(intake).isComplete).toBe(true);
    expect(exchangeCount).toBeLessThanOrEqual(4);
    expect(readIntakeNextStep(intake, true).step).toBe('create');
  });

  it('asks the PO at most one question per five work items, beyond labels (SC-004)', async () => {
    const { intake, poQuestionCount } = await runGh387();
    const workItemCount = intake.items.filter((item) => readSettledValue(item.decisions.kind) === 'work').length;
    expect(poQuestionCount).toBeLessThanOrEqual(Math.ceil(workItemCount / 5));
  });

  it('never readies a Fulfillment-owned, deferred or risk item for creation, and matches the named open Epic (SC-002/003)', async () => {
    const { intake } = await runGh387();
    for (const item of intake.items.filter(isItemReadyToCreate)) {
      expect(readSettledValue(item.decisions.kind)).toBe('work');
      // Enrollment's own work, or its part of Shared work — never Fulfillment's, never non-work.
      expect(isEnrollmentOwned(readSettledValue(item.decisions.owner))).toBe(true);
    }
    const coreIntegration = intake.items.find((item) => item.title.startsWith('Core Integration'));
    expect(readSettledValue(coreIntegration!.decisions.duplicate)).toEqual({ verdict: 'existing', key: 'DENP-632' });
  });

  it('gives every summary row a key or a reason (SC-006)', async () => {
    const { intake } = await runGh387();
    const { workRows, otherRows } = buildSummaryRows(intake, 'https://jira.example.com');
    for (const row of [...workRows, ...otherRows]) {
      expect(row.jiraKey !== null || row.reason.trim() !== '').toBe(true);
    }
  });
});
