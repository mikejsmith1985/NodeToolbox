// definitionOfReady.ts — What "ready" means for a Feature, and how to write one that reads well.
//
// The live hygiene checklist tells a PO which FIELDS are unset. It cannot tell them whether the Feature
// is any good — whether the problem is stated, the value is clear, or anyone could tell when it is done.
// That is what this content is for. The two sit side by side: one mechanical, one judgement.
//
// Authored, deterministic, no gate, no network — identical whether or not the AI assist is unlocked
// (FR-026, FR-029, SC-013).

/** One thing a Feature needs before a team should be asked to commit to it. */
export interface ReadinessCriterion {
  id: string;
  name: string;
  /** What it means, in plain language. */
  description: string;
  /** The question to ask of the Feature in front of you. */
  prompt: string;
}

/**
 * The Definition of Ready, ordered the way a Feature is actually written: why, then what, then how big,
 * then who else is involved.
 */
export const DEFINITION_OF_READY: readonly ReadinessCriterion[] = [
  {
    id: 'problem',
    name: 'The problem is stated, not the solution',
    description:
      'A ready Feature says what is wrong or missing today and for whom. A Feature that opens with the solution hides the reasoning that would let a team propose a better one.',
    prompt: 'Could a reader say what problem this solves without you in the room?',
  },
  {
    id: 'value',
    name: 'The value is explicit',
    description:
      'Say who is better off and how — time saved, risk removed, revenue enabled, a rule complied with. "The business wants it" is not value; it is a sponsor.',
    prompt: 'If this shipped and nothing else changed, what would measurably improve?',
  },
  {
    id: 'scope-boundary',
    name: 'The edges are drawn',
    description:
      'What is deliberately NOT in this Feature is as useful as what is. An unbounded Feature grows silently during the PI, and no one can tell when it is finished.',
    prompt: 'What might a reasonable person assume is included that is not?',
  },
  {
    id: 'acceptance',
    name: 'Acceptance criteria are testable',
    description:
      'Someone who did not write the Feature should be able to read the criteria and say "yes, that happened" or "no, it did not" — with no discussion.',
    prompt: 'Could a tester check every criterion without asking you what you meant?',
  },
  {
    id: 'size',
    name: 'It fits in a PI',
    description:
      'A Feature too large to finish in a Program Increment is a plan, not a Feature. If it cannot be sized with any confidence, that is a signal to split it rather than to estimate harder.',
    prompt: 'Could this realistically be done inside one PI? If not, split it first.',
  },
  {
    id: 'dependencies',
    name: 'Dependencies are named',
    description:
      'Other teams, vendors, data, environments, approvals. A dependency discovered at PI planning costs a conversation; one discovered in the PI costs the increment.',
    prompt: 'Who or what outside this team must do something before this can be done?',
  },
  {
    id: 'risks',
    name: 'The risks are written down',
    description:
      'What could make this take much longer than expected, or not work at all? Naming a risk early is cheap and makes the estimate honest.',
    prompt: 'What is the thing most likely to go wrong here?',
  },
  {
    id: 'owner',
    name: 'It has an owner and a home',
    description:
      'A Product Owner, a target PI, and the fields your organisation runs its reporting on. This is the mechanical half — the checklist beside this list tracks it for you.',
    prompt: 'Is every field your teams rely on filled in?',
  },
];

/** Looks a criterion up by id; returns null for an unknown id rather than throwing. */
export function findReadinessCriterion(criterionId: string): ReadinessCriterion | null {
  return DEFINITION_OF_READY.find((criterion) => criterion.id === criterionId) ?? null;
}

/** Practical advice on wording, distinct from the readiness bar itself. */
export const FEATURE_WRITING_TIPS: readonly string[] = [
  'Write the summary as the outcome, not the task: "Claimants can submit supporting documents", not "Build upload API".',
  'Lead the description with the problem and who has it. Put the proposed approach after, clearly marked as a proposal.',
  'Prefer concrete numbers over adjectives — "3,000 claims a day" tells a team more than "high volume".',
  'Link the evidence rather than retyping it: the Confluence page, the spreadsheet, the ticket it came from.',
  'If you cannot write testable acceptance criteria, the Feature is not understood well enough yet — that is information, not a blocker.',
];
