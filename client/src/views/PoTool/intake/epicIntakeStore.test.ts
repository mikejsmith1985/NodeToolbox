// epicIntakeStore.test.ts — Contract tests for the intake store (spec 037, contracts/summary-and-store.md §2/§3):
// round-trip, schema/shape validation, team scoping, list/delete, and the "never throws" storage-failure paths.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canPersistDrafts: vi.fn(() => true) }));
vi.mock('../drafts/splitDraftStorage', () => ({ canPersistDrafts: mocks.canPersistDrafts }));

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
} from './epicIntakeModel.ts';
import {
  deleteEpicIntake,
  EPIC_INTAKE_STORAGE_PREFIX,
  loadEpicIntake,
  listEpicIntakes,
  normalizeEpicIntake,
  saveEpicIntake,
} from './epicIntakeStore.ts';

// ── Builders ──

/** A realistic full record: a mix of settled, open and not-applicable decisions, a draft and a created Epic. */
function buildRealisticIntake(overrides: Partial<EpicIntake> = {}): EpicIntake {
  const workItem = createIntakeItem(1, 'Add SSO for partner portal', [1, 2]);
  workItem.decisions.kind = { state: 'settled', value: 'work', settledBy: 'rule', reason: 'Looks like work', aiAttempts: 0 };
  workItem.decisions.owner = { state: 'settled', value: 'enrollment', settledBy: 'rule', reason: 'Stated size names Enrollment', aiAttempts: 1 };
  workItem.decisions.searchTerms = { state: 'settled', value: ['SSO partner portal'], settledBy: 'ai', reason: 'Derived from title', aiAttempts: 1 };
  workItem.decisions.duplicate = { state: 'settled', value: { verdict: 'createNew' }, settledBy: 'ai', reason: 'No candidates found', aiAttempts: 1 };
  workItem.decisions.label = { state: 'settled', value: 'Roadmap', settledBy: 'po', reason: 'PO chose Roadmap', aiAttempts: 0 };
  workItem.decisions.draftAccepted = { state: 'settled', value: 'accepted', settledBy: 'po', reason: 'PO accepted', aiAttempts: 0 };
  workItem.areaSizes = [{ area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: '1.2M', lineNumber: 1 }];
  workItem.namedKeys = [{ key: 'DENP-1', projectKey: 'DENP', lineNumber: 1, lookup: { status: 'notRun' } }];
  workItem.deferralEvidence = null;
  workItem.aiEnrollmentShare = 80;
  workItem.candidates = [{ key: 'DENP-9', summary: 'Existing SSO work', statusName: 'In Progress', statusCategory: 'indeterminate', descriptionExcerpt: 'Partner SSO...', foundBy: 'search' }];
  workItem.searchStatus = 'ok';
  workItem.draft = { summary: 'Add SSO for partner portal', description: 'Description:\nSSO work', source: 'ai', editedByPo: true };
  workItem.creation = { state: 'created', key: 'DENP-100', createdAtIso: '2026-09-18T00:00:00.000Z' };

  const openItem = createIntakeItem(2, 'Undecided item', [3]);

  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-alpha',
    name: 'GH #387 notes — 2026-09-18',
    targetProjectKey: 'DENP',
    createdAtIso: '2026-09-18T00:00:00.000Z',
    updatedAtIso: '2026-09-18T01:00:00.000Z',
    sourceTitles: ['PI Planning notes'],
    lines: [
      { lineNumber: 1, text: 'Add SSO for partner portal', rawText: '- Add SSO for partner portal', outlineLevel: 1 },
      { lineNumber: 2, text: 'Enrollment XL (1.2M)', rawText: '  o Enrollment XL (1.2M)', outlineLevel: 2 },
      { lineNumber: 3, text: 'Undecided item', rawText: '- Undecided item', outlineLevel: 1 },
      { lineNumber: 4, text: 'Just a heading', rawText: 'Notes:', outlineLevel: 0 },
    ],
    items: [workItem, openItem],
    setAsideLines: [{ lineNumber: 4, reason: 'headingOrProse', settledBy: 'rule', note: null }],
    epicType: { state: 'resolved', id: '10001', name: 'Epic' },
    batchRequiredFieldValues: { customfield_priority: 'High' },
    roundHistory: [
      { kind: 'epicIntakeClassify', partIndex: 0, partCount: 1, acceptedCount: 2, rejected: [{ itemId: null, reason: 'Malformed JSON' }], ingestedAtIso: '2026-09-18T00:30:00.000Z' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.canPersistDrafts.mockReturnValue(true);
});

// ── Round trip ──

describe('save / load — round trip', () => {
  it('round-trips a full realistic record unchanged', () => {
    const intake = buildRealisticIntake();
    expect(saveEpicIntake(intake)).toBe(true);
    const result = loadEpicIntake('team-alpha', 'intake-1');
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.intake).toEqual(intake);
    }
  });

  it('reports missing for an absent key', () => {
    expect(loadEpicIntake('team-alpha', 'nope')).toEqual({ status: 'missing' });
  });
});

// ── Validation ──

describe('normalizeEpicIntake / loadEpicIntake — validation', () => {
  it('rejects a wrong schemaVersion as unreadable', () => {
    const intake = buildRealisticIntake();
    window.localStorage.setItem(
      `${EPIC_INTAKE_STORAGE_PREFIX}:intake-1:team-alpha`,
      JSON.stringify({ ...intake, schemaVersion: 99 }),
    );
    const result = loadEpicIntake('team-alpha', 'intake-1');
    expect(result.status).toBe('unreadable');
    expect(normalizeEpicIntake({ ...intake, schemaVersion: 99 })).toBeNull();
  });

  it('rejects a corrupt enum value (invalid item kind) as unreadable', () => {
    const intake = buildRealisticIntake();
    const corrupted = {
      ...intake,
      items: [
        {
          ...intake.items[0],
          decisions: {
            ...intake.items[0].decisions,
            kind: { state: 'settled', value: 'not-a-real-kind', settledBy: 'rule', reason: 'x', aiAttempts: 0 },
          },
        },
        intake.items[1],
      ],
    };
    window.localStorage.setItem(`${EPIC_INTAKE_STORAGE_PREFIX}:intake-1:team-alpha`, JSON.stringify(corrupted));
    expect(loadEpicIntake('team-alpha', 'intake-1').status).toBe('unreadable');
    expect(normalizeEpicIntake(corrupted)).toBeNull();
  });

  it('rejects garbage JSON as unreadable', () => {
    window.localStorage.setItem(`${EPIC_INTAKE_STORAGE_PREFIX}:intake-1:team-alpha`, 'not json at all {{{');
    expect(loadEpicIntake('team-alpha', 'intake-1').status).toBe('unreadable');
  });

  it('rejects a non-object payload', () => {
    expect(normalizeEpicIntake(null)).toBeNull();
    expect(normalizeEpicIntake('a string')).toBeNull();
    expect(normalizeEpicIntake(42)).toBeNull();
  });

  it('rejects a duplicate verdict of "existing" with no key', () => {
    const intake = buildRealisticIntake();
    const corrupted = {
      ...intake,
      items: [
        {
          ...intake.items[0],
          decisions: {
            ...intake.items[0].decisions,
            duplicate: { state: 'settled', value: { verdict: 'existing' }, settledBy: 'ai', reason: 'x', aiAttempts: 0 },
          },
        },
        intake.items[1],
      ],
    };
    expect(normalizeEpicIntake(corrupted)).toBeNull();
  });
});

// ── Team scoping ──

describe('team scoping', () => {
  it('isolates two team profiles under the same intake id', () => {
    const alphaIntake = buildRealisticIntake({ teamProfileId: 'team-alpha', name: 'Alpha intake' });
    const betaIntake = buildRealisticIntake({ teamProfileId: 'team-beta', name: 'Beta intake' });
    saveEpicIntake(alphaIntake);
    saveEpicIntake(betaIntake);

    const alphaResult = loadEpicIntake('team-alpha', 'intake-1');
    const betaResult = loadEpicIntake('team-beta', 'intake-1');
    expect(alphaResult.status).toBe('loaded');
    expect(betaResult.status).toBe('loaded');
    if (alphaResult.status === 'loaded' && betaResult.status === 'loaded') {
      expect(alphaResult.intake.name).toBe('Alpha intake');
      expect(betaResult.intake.name).toBe('Beta intake');
    }
  });
});

// ── List ──

describe('listEpicIntakes', () => {
  it('lists this team\'s intakes newest first, excluding other teams', () => {
    saveEpicIntake(buildRealisticIntake({ id: 'intake-1', teamProfileId: 'team-alpha', name: 'First', updatedAtIso: '2026-09-18T00:00:00.000Z' }));
    saveEpicIntake(buildRealisticIntake({ id: 'intake-2', teamProfileId: 'team-alpha', name: 'Second', updatedAtIso: '2026-09-18T02:00:00.000Z' }));
    saveEpicIntake(buildRealisticIntake({ id: 'intake-3', teamProfileId: 'team-beta', name: 'Other team' }));

    const summaries = listEpicIntakes('team-alpha');
    expect(summaries.map((summary) => summary.id)).toEqual(['intake-2', 'intake-1']);
    expect(summaries.every((summary) => summary.teamProfileId === 'team-alpha')).toBe(true);
  });

  it('still lists an unreadable record, named "(unreadable intake)"', () => {
    window.localStorage.setItem(`${EPIC_INTAKE_STORAGE_PREFIX}:intake-bad:team-alpha`, 'not json {{{');
    const summaries = listEpicIntakes('team-alpha');
    expect(summaries).toEqual([{ id: 'intake-bad', name: '(unreadable intake)', updatedAtIso: '', teamProfileId: 'team-alpha' }]);
  });

  it('returns an empty list when storage is unavailable', () => {
    mocks.canPersistDrafts.mockReturnValue(false);
    expect(listEpicIntakes('team-alpha')).toEqual([]);
  });
});

// ── Save failure ──

describe('saveEpicIntake — failure paths', () => {
  it('returns false when storage is unavailable', () => {
    mocks.canPersistDrafts.mockReturnValue(false);
    expect(saveEpicIntake(buildRealisticIntake())).toBe(false);
  });

  it('returns false when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(saveEpicIntake(buildRealisticIntake())).toBe(false);
    vi.restoreAllMocks();
  });

  it('logs a console warning for a record over the size threshold', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hugeIntake = buildRealisticIntake({ name: 'x'.repeat(1_100_000) });
    saveEpicIntake(hugeIntake);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── Delete ──

describe('deleteEpicIntake', () => {
  it('removes the record so a later load reports missing', () => {
    saveEpicIntake(buildRealisticIntake());
    expect(loadEpicIntake('team-alpha', 'intake-1').status).toBe('loaded');
    deleteEpicIntake('team-alpha', 'intake-1');
    expect(loadEpicIntake('team-alpha', 'intake-1')).toEqual({ status: 'missing' });
  });
});
