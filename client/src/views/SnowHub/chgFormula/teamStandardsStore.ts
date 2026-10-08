// teamStandardsStore.ts — The team's standing answers to Formula Card fields, kept on this machine (GH #415).
//
// The answers change rarely but they do change — a new escalation contact, a different bridge practice — and a
// change of practice should not need a release. Admin Hub edits them; the risk check reads them on every run.
// Stored under a "tbx" key, so Settings Backup carries them with every other setting.

/** One standing answer: the card field it settles and what the team always says for it. */
export interface TeamStandard {
  fieldName: string;
  answer: string;
}

/** Where the standing answers are kept. */
export const TEAM_STANDARDS_STORAGE_KEY = 'tbxChgTeamStandards';

/** The answers the team gave in GH #415 — used until someone edits them, and restored by Reset. */
export const DEFAULT_TEAM_STANDARDS: readonly TeamStandard[] = [
  { fieldName: 'Bridge or Command Center', answer: 'The change owner schedules the bridge after the change is approved.' },
  { fieldName: 'Test Results', answer: 'Test evidence is always attached to the change.' },
  { fieldName: 'Escalation Path', answer: 'Escalation starts with the CI Director and progresses as required.' },
];

/** True for a stored row that names a field and says something about it. */
function isUsableStandard(candidate: unknown): candidate is TeamStandard {
  const standard = candidate as Partial<TeamStandard> | null;
  return typeof standard?.fieldName === 'string' && typeof standard.answer === 'string'
    && standard.fieldName.trim() !== '' && standard.answer.trim() !== '';
}

/** The standing answers: the saved ones, or the defaults when none are saved or they cannot be read. */
export function readTeamStandards(storage: Storage = window.localStorage): TeamStandard[] {
  try {
    const storedText = storage.getItem(TEAM_STANDARDS_STORAGE_KEY);
    if (storedText === null) {
      return [...DEFAULT_TEAM_STANDARDS];
    }
    const storedRows: unknown = JSON.parse(storedText);
    return Array.isArray(storedRows) ? storedRows.filter(isUsableStandard) : [...DEFAULT_TEAM_STANDARDS];
  } catch {
    return [...DEFAULT_TEAM_STANDARDS];
  }
}

/** Saves the standing answers, dropping any row left blank. An empty list is kept: no standards, on purpose. */
export function writeTeamStandards(standards: readonly TeamStandard[], storage: Storage = window.localStorage): void {
  const usableStandards = standards
    .filter(isUsableStandard)
    .map((standard) => ({ fieldName: standard.fieldName.trim(), answer: standard.answer.trim() }));
  try {
    storage.setItem(TEAM_STANDARDS_STORAGE_KEY, JSON.stringify(usableStandards));
  } catch {
    // Storage can be full or blocked; the defaults keep the risk check working.
  }
}

/** Forgets the edits, so the defaults apply again. */
export function resetTeamStandards(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(TEAM_STANDARDS_STORAGE_KEY);
  } catch {
    // Nothing stored, or storage blocked — the defaults apply either way.
  }
}
