// evidenceRules.ts — What an assistant may write into a change: only what the evidence supplied here supports.
//
// Told "the implementation plan is generic", an assistant wrote plausible health checks, integration checks and
// validations that no CTASK, story or record mentioned — the kind of filler a Release Manager rejects as invented.
// The strongest plan was the one built from the CTASKs' own deployment details (repos, PRs, jobs). These rules
// set that as the standard for every CHG prompt (GH #415): facts may be copied, reworded or combined; nothing
// "typical" may be added; a missing fact is named, never filled in.

/** The traceability rules, stated once in every prompt that drafts, checks or fixes a change. */
export const EVIDENCE_RULE_LINES: readonly string[] = [
  'Evidence rules (strict): Every statement must trace to the evidence supplied here — the change record and its '
    + 'text, the change tasks and their instructions, the Jira work, the attached files, the team standards, or the '
    + 'owner\'s answers.',
  '- Copy those facts, reword them, combine them, or turn deployment details (repos, PRs, jobs, environments, '
    + 'tags) into numbered steps. That is all.',
  '- Never add health checks, monitoring checks, deployment commands, validation activities or rollback activities '
    + 'that the evidence does not already contain — not even typical ones.',
  '- When a reviewer asks for more detail, add specificity only by exposing facts already present elsewhere in the '
    + 'change package (a CTASK\'s instructions into the implementation plan, for example).',
  '- When something needed is not in the evidence, name the gap instead of inventing likely content.',
];
