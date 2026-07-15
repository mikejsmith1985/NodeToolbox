// splitHeuristics.ts — The deterministic coaching shown beside a Feature being split.
//
// Product Owners rarely split badly through carelessness; they split badly because the good heuristics
// are not in front of them at the moment they need them. This is that content, authored and fixed.
//
// It is deliberately plain data: no network call, no AI, no gate. A PO who has never unlocked the AI
// assist gets exactly the same coaching as one who has, and nothing here can block a split — it is
// advice, not a rule (FR-010, FR-011, SC-013).

/** One way of cutting a large Feature into smaller Features that each still deliver value. */
export interface SplitHeuristic {
  /** Stable id, safe to persist in a draft. */
  id: string;
  /** Short label shown on the card. */
  name: string;
  /** What the heuristic means, in plain language. */
  description: string;
  /** A concrete worked example — the part that actually teaches. */
  example: string;
  /** The question to ask yourself about YOUR Feature to apply this heuristic. */
  prompt: string;
}

/**
 * The heuristics, ordered by how often they unblock a stuck PO.
 *
 * Happy-path-first leads deliberately: when a Feature feels indivisible it is almost always because the
 * exceptions are being carried along with the main case, and separating them is the cut that works.
 */
export const SPLIT_HEURISTICS: readonly SplitHeuristic[] = [
  {
    id: 'happy-path-first',
    name: 'Happy path first',
    description:
      'Ship the straightforward case on its own, then the exceptions, errors, and edge cases as follow-ups. Most Features feel too big only because every unhappy path is bundled into them.',
    example:
      'A claim submission Feature becomes: (1) submit a valid claim end to end; (2) handle a rejected claim; (3) handle a claim that times out mid-submission.',
    prompt: 'What is the simplest version that a real user could actually complete? Ship that first.',
  },
  {
    id: 'workflow-step',
    name: 'By workflow step',
    description:
      'A Feature that spans several steps of a process can often be delivered one step at a time, with each step useful the moment it lands.',
    example:
      'An onboarding Feature becomes: (1) capture applicant details; (2) verify identity; (3) issue the account. Step 1 is useful on its own — the team can start collecting real applications.',
    prompt: 'Walk the process end to end. Which single step could be delivered and used before the rest exists?',
  },
  {
    id: 'business-rule',
    name: 'By business rule',
    description:
      'When a Feature carries several rules, policies, or conditions, each rule can usually be its own increment. The first one proves the mechanism; the rest are variations on it.',
    example:
      'A pricing Feature becomes: (1) standard rate; (2) volume discount; (3) promotional override. The first delivers correct pricing for most customers.',
    prompt: 'List every rule this Feature enforces. Which one covers the most cases on its own?',
  },
  {
    id: 'data-variation',
    name: 'By data variation',
    description:
      'A Feature that must handle many kinds of input can start with one kind. The shape of the work is the same; only the coverage grows.',
    example:
      'A document upload Feature becomes: (1) a single PDF; (2) multiple files at once; (3) scanned images needing OCR.',
    prompt: 'Which one input type covers most real usage? Start there and add the rest deliberately.',
  },
  {
    id: 'operations',
    name: 'By operation (CRUD)',
    description:
      'Create, read, update, and delete are separate increments. Reading is often valuable long before editing exists, and delete is frequently not needed at all.',
    example:
      'A team roster Feature becomes: (1) view the roster; (2) add a member; (3) edit a member; (4) remove a member.',
    prompt: 'Which operations does this Feature bundle? Would viewing alone already help someone?',
  },
  {
    id: 'effort-vs-value',
    name: 'Separate the expensive part',
    description:
      'When most of a Feature is cheap but one slice is expensive, split the expensive slice out. The cheap majority ships now; the costly part gets sized and scheduled honestly instead of hiding inside an estimate.',
    example:
      'A reporting Feature becomes: (1) the report from data we already hold; (2) the same report enriched from the third-party feed that needs a new integration and a vendor contract.',
    prompt: 'Which single part of this Feature is driving the estimate? Can the rest ship without it?',
  },
  {
    id: 'interface-variation',
    name: 'By interface or channel',
    description:
      'A Feature that must work everywhere can land one place at a time — one channel, platform, or surface first.',
    example:
      'A notification Feature becomes: (1) in-app notification; (2) email; (3) mobile push.',
    prompt: 'Where would this deliver the most value first? Does it truly need every channel on day one?',
  },
  {
    id: 'defer-performance',
    name: 'Correct first, fast later',
    description:
      'Getting the behaviour right and making it fast (or scalable) are two increments. A correct-but-slow version is often genuinely useful, and it tells you whether the fast version is worth building.',
    example:
      'A search Feature becomes: (1) accurate results, no caching; (2) sub-second results at full catalogue size.',
    prompt: 'Is a correct but slower version useful to anyone? If so, that is your first increment.',
  },
];

/** Looks a heuristic up by id; returns null for an unknown id rather than throwing. */
export function findSplitHeuristic(heuristicId: string): SplitHeuristic | null {
  return SPLIT_HEURISTICS.find((heuristic) => heuristic.id === heuristicId) ?? null;
}

/** The test a proposed increment should pass, shown alongside the heuristics. */
export const GOOD_INCREMENT_TESTS: readonly string[] = [
  'It delivers something a user or the business would actually notice.',
  'It can be released on its own, without waiting for its siblings.',
  'It is small enough to finish comfortably inside one Program Increment.',
  'You can say what "done" means for it without referring to the other increments.',
  'It is worth doing even if the remaining increments were never built.',
];
