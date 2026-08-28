// teamContextStore.ts — Remembering what somebody told the assistant about their team.
//
// The context box is the difference between a generic answer and a useful one: "reduce work in
// progress" is true of almost every board ever measured, and useless to somebody who already knows
// their tester is the constraint. It is also several sentences of typing.
//
// Held only in component state, it disappeared the moment AI Assist was toggled off — the panel
// unmounts, and with it whatever had been typed into it. Retyping the same three sentences on every
// run is the kind of friction that stops a feature being used at all.
//
// So it is kept. It describes the TEAM rather than the run: it is the same next week, and there is no
// reason anybody should type it twice.

/** Where the context lives. Named for what it holds so a stray key is recognisable in dev tools. */
const TEAM_CONTEXT_STORAGE_KEY = 'tbxDeliveryHealthTeamContext';

/**
 * More than anybody will type, and far less than a document.
 *
 * The cap exists because this rides in a prompt beside the figures: context long enough to crowd out
 * the report would produce a reading of the context rather than of the data.
 */
export const MAX_TEAM_CONTEXT_CHARS = 2000;

/**
 * Reads the saved context, or an empty string.
 *
 * Every failure path returns empty rather than throwing. Storage can be unavailable — a locked-down
 * browser, a private window — and a report that refused to render because it could not read a note
 * about the team would be a poor trade for a convenience.
 */
export function readTeamContext(): string {
  try {
    return localStorage.getItem(TEAM_CONTEXT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Saves the context, trimmed to the cap.
 *
 * Silent on failure by the same reasoning: not being able to remember a note is a smaller problem than
 * an error somebody has to dismiss every time they type a character.
 */
export function writeTeamContext(teamContext: string): void {
  try {
    localStorage.setItem(TEAM_CONTEXT_STORAGE_KEY, teamContext.slice(0, MAX_TEAM_CONTEXT_CHARS));
  } catch {
    // Session-only, then. The box still works for this run.
  }
}
