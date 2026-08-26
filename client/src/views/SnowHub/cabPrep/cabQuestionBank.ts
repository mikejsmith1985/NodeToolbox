// cabQuestionBank.ts — The questions a change advisory board actually asks.
//
// This is the part of the CAB feature that carries the value. Asking a model for "some questions the
// board might ask" produces the four everybody already thought of; the useful ones are the ones a
// director asks that nobody in the room prepared for, and those follow a stable pattern because a
// CAB is a risk-acceptance meeting rather than a status review.
//
// So the question set is OURS, not the model's. The model is given this taxonomy and asked to answer
// it against a specific change — which is a research task it is good at — rather than to invent the
// agenda, which it is not. That also makes the pack comparable between changes: the same board gets
// the same shape of answer every week.
//
// Pure data and pure selection. Nothing here reaches Jira, ServiceNow, or a model.

/** Why a board asks — the concern behind a family of questions. */
export type CabConcern =
  | 'justification'
  | 'blast-radius'
  | 'failure-modes'
  | 'evidence'
  | 'backout'
  | 'timing'
  | 'dependencies'
  | 'detection'
  | 'communications'
  | 'compliance'
  | 'people'
  | 'scope-confidence';

/** One question, and why it is being asked. */
export interface CabQuestion {
  id: string;
  concern: CabConcern;
  question: string;
  /**
   * What the asker is really checking.
   *
   * Carried into the prompt so the answer addresses the concern rather than the wording. "Why do we
   * have to do this?" is rarely a request for the business case — it is usually a test of whether
   * the change could have waited, and an answer that recites the benefit misses it.
   */
  whatTheyAreReallyAsking: string;
  /** True for the ones that most often go unprepared. Shown first, and flagged in the pack. */
  isCommonlyUnprepared: boolean;
}

/** Readable names for each concern, used as the pack's section headings. */
export const CAB_CONCERN_LABELS: Record<CabConcern, string> = {
  justification: 'Why at all, and why now',
  'blast-radius': 'Who and what this touches',
  'failure-modes': 'What could go wrong',
  evidence: 'What has actually been proven',
  backout: 'Getting back if it goes wrong',
  timing: 'Why this window',
  dependencies: 'What this waits on, and what waits on it',
  detection: 'How we will know',
  communications: 'Who has been told',
  compliance: 'Approvals and obligations',
  people: 'Who is on it',
  'scope-confidence': 'Is the scope real',
};

/**
 * The question bank.
 *
 * Written as the board would say them, not as a form would. A director does not ask "please describe
 * the backout procedure"; they ask "if this goes wrong at 2am, who is awake and what do they do".
 * The plainer phrasing is what makes an answer that fits the question rather than the field.
 */
export const CAB_QUESTIONS: CabQuestion[] = [
  // ── Why at all, and why now ───────────────────────────────────────────────
  {
    id: 'why-at-all',
    concern: 'justification',
    question: 'Why do we have to do this?',
    whatTheyAreReallyAsking: 'Whether this is required work or preferred work, and who decided.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'why-now',
    concern: 'justification',
    question: 'Why does this have to go now rather than next cycle?',
    whatTheyAreReallyAsking:
      'Whether the date is driven by something real — a regulatory date, a dependency, an expiring '
      + 'contract — or by a team wanting to be done. This is the question that most often exposes a '
      + 'change that could safely have waited.',
    isCommonlyUnprepared: true,
  },
  {
    id: 'impact-if-we-do',
    concern: 'justification',
    question: 'What is the impact if we do this?',
    whatTheyAreReallyAsking: 'The change to the business, stated as an outcome rather than a deliverable.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'impact-if-we-dont',
    concern: 'justification',
    question: 'What is the impact if we do not?',
    whatTheyAreReallyAsking:
      'Whether the cost of waiting is concrete. "We fall behind" is not an answer; "the vendor '
      + 'contract lapses on the 30th" is.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'do-nothing-option',
    concern: 'justification',
    question: 'What was the option you rejected, and why?',
    whatTheyAreReallyAsking:
      'Whether alternatives were considered at all. A change with no rejected alternative usually '
      + 'means the first idea was implemented.',
    isCommonlyUnprepared: true,
  },

  // ── Who and what this touches ─────────────────────────────────────────────
  {
    id: 'who-is-affected',
    concern: 'blast-radius',
    question: 'Who is affected if this goes wrong — and how many of them?',
    whatTheyAreReallyAsking: 'A number. Members, providers, internal users, downstream teams.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'systems-touched',
    concern: 'blast-radius',
    question: 'Which systems does this touch that are not named in the change?',
    whatTheyAreReallyAsking:
      'Indirect blast radius. Shared databases, shared queues, a service another team also calls.',
    isCommonlyUnprepared: true,
  },
  {
    id: 'data-touched',
    concern: 'blast-radius',
    question: 'Does this change data, or only code?',
    whatTheyAreReallyAsking:
      'Whether a backout actually restores the previous state. Code rolls back; data migrations '
      + 'frequently do not.',
    isCommonlyUnprepared: true,
  },

  // ── What could go wrong ───────────────────────────────────────────────────
  {
    id: 'worst-case',
    concern: 'failure-modes',
    question: 'What is the worst thing that can happen here?',
    whatTheyAreReallyAsking: 'Whether the team has thought past the happy path.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'failed-before',
    concern: 'failure-modes',
    question: 'Has a change like this failed before? What happened?',
    whatTheyAreReallyAsking:
      'Institutional memory. A board that remembers a previous incident will ask what is different '
      + 'this time, and the honest answer may be "nothing".',
    isCommonlyUnprepared: true,
  },
  {
    id: 'partial-failure',
    concern: 'failure-modes',
    question: 'What happens if it half-succeeds?',
    whatTheyAreReallyAsking:
      'The state nobody plans for. Two of three services deployed, a migration that stopped midway.',
    isCommonlyUnprepared: true,
  },

  // ── What has actually been proven ─────────────────────────────────────────
  {
    id: 'what-was-tested',
    concern: 'evidence',
    question: 'What was tested, where, and by whom?',
    whatTheyAreReallyAsking: 'Evidence, not assurance. Which environment, which date, which person.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'what-was-not-tested',
    concern: 'evidence',
    question: 'What could not be tested, and why?',
    whatTheyAreReallyAsking:
      'The honest gap. Every change has one — production-only data, a third-party sandbox that does '
      + 'not exist — and a team that claims none has usually not looked.',
    isCommonlyUnprepared: true,
  },
  {
    id: 'prod-difference',
    concern: 'evidence',
    question: 'How does production differ from where this was tested?',
    whatTheyAreReallyAsking: 'Data volume, integrations, configuration, load.',
    isCommonlyUnprepared: true,
  },

  // ── Getting back if it goes wrong ─────────────────────────────────────────
  {
    id: 'how-back-out',
    concern: 'backout',
    question: 'How do we back this out, and how long does it take?',
    whatTheyAreReallyAsking: 'A duration. "We can roll back" without a number is not a plan.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'backout-tested',
    concern: 'backout',
    question: 'Has the backout itself been tested?',
    whatTheyAreReallyAsking:
      'Almost always no. The question is asked precisely because the answer is usually no, and the '
      + 'board wants to hear it said rather than discovered.',
    isCommonlyUnprepared: true,
  },
  {
    id: 'point-of-no-return',
    concern: 'backout',
    question: 'At what point can we no longer back out?',
    whatTheyAreReallyAsking:
      'The decision deadline during the window. Boards want to know when the go/no-go actually is.',
    isCommonlyUnprepared: true,
  },

  // ── Why this window ───────────────────────────────────────────────────────
  {
    id: 'why-this-window',
    concern: 'timing',
    question: 'Why this window, and what else is going on in it?',
    whatTheyAreReallyAsking: 'Collisions with other changes, month-end, open enrolment, a freeze.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'window-overrun',
    concern: 'timing',
    question: 'What happens if it overruns the window?',
    whatTheyAreReallyAsking: 'Whether there is a hard stop, and who makes that call.',
    isCommonlyUnprepared: true,
  },

  // ── Dependencies ──────────────────────────────────────────────────────────
  {
    id: 'must-go-first',
    concern: 'dependencies',
    question: 'What has to happen before this, and is it done?',
    whatTheyAreReallyAsking: 'Whether the change is actually ready or is being approved hopefully.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'waits-on-this',
    concern: 'dependencies',
    question: 'What is waiting on this?',
    whatTheyAreReallyAsking: 'The cost of a deferral, in other teams.',
    isCommonlyUnprepared: true,
  },

  // ── How we will know ──────────────────────────────────────────────────────
  {
    id: 'how-know-worked',
    concern: 'detection',
    question: 'How will you know it worked?',
    whatTheyAreReallyAsking: 'A specific check, run by a specific person, at a specific time.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'how-know-broke',
    concern: 'detection',
    question: 'How will you know it broke — and how quickly?',
    whatTheyAreReallyAsking:
      'Monitoring and time to detect. A failure found by a member calling support is a different '
      + 'change from one found by an alert in ninety seconds.',
    isCommonlyUnprepared: true,
  },

  // ── Who has been told ─────────────────────────────────────────────────────
  {
    id: 'who-informed',
    concern: 'communications',
    question: 'Who has been told, and who still needs to be?',
    whatTheyAreReallyAsking: 'Downstream teams, support, the business owner.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'support-ready',
    concern: 'communications',
    question: 'Does support know what to do if calls come in?',
    whatTheyAreReallyAsking: 'Whether the service desk has been briefed, or will be finding out live.',
    isCommonlyUnprepared: true,
  },

  // ── Approvals and obligations ─────────────────────────────────────────────
  {
    id: 'approvals',
    concern: 'compliance',
    question: 'Whose approval does this need beyond this board?',
    whatTheyAreReallyAsking: 'Security, architecture, the data owner, a vendor.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'regulatory',
    concern: 'compliance',
    question: 'Does this touch anything with a regulatory or contractual obligation attached?',
    whatTheyAreReallyAsking:
      'In a healthcare setting: member data, claims, enrolment deadlines, audit trails. A change '
      + 'that does is judged on a different standard.',
    isCommonlyUnprepared: true,
  },

  // ── Who is on it ──────────────────────────────────────────────────────────
  {
    id: 'who-is-on-bridge',
    concern: 'people',
    question: 'Who is executing this, and who is available if it goes wrong?',
    whatTheyAreReallyAsking: 'Names and an escalation path, not a team name.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'single-point',
    concern: 'people',
    question: 'Is there one person who has to be awake for this to work?',
    whatTheyAreReallyAsking: 'Key-person risk, which a board treats as a real risk.',
    isCommonlyUnprepared: true,
  },

  // ── Is the scope real ─────────────────────────────────────────────────────
  {
    id: 'scope-complete',
    concern: 'scope-confidence',
    question: 'Is everything in this change actually finished?',
    whatTheyAreReallyAsking: 'Whether any scoped item is still open, in test, or unestimated.',
    isCommonlyUnprepared: false,
  },
  {
    id: 'scope-changed',
    concern: 'scope-confidence',
    question: 'What was pulled out of this change, and why?',
    whatTheyAreReallyAsking:
      'Late descoping. A board that learns scope moved last week wants to know what that did to the '
      + 'testing that was already done.',
    isCommonlyUnprepared: true,
  },
];

/** The questions belonging to one concern, in bank order. */
export function readQuestionsForConcern(concern: CabConcern): CabQuestion[] {
  return CAB_QUESTIONS.filter((question) => question.concern === concern);
}

/**
 * The questions teams most often walk in without an answer to.
 *
 * Surfaced separately because the obvious four get prepared anyway. The value of the pack is in the
 * ones that get asked ninth.
 */
export function readCommonlyUnpreparedQuestions(): CabQuestion[] {
  return CAB_QUESTIONS.filter((question) => question.isCommonlyUnprepared);
}

/** Every concern that has at least one question, in the order the pack presents them. */
export function readOrderedConcerns(): CabConcern[] {
  const seenConcerns: CabConcern[] = [];
  CAB_QUESTIONS.forEach((question) => {
    if (!seenConcerns.includes(question.concern)) {
      seenConcerns.push(question.concern);
    }
  });
  return seenConcerns;
}
