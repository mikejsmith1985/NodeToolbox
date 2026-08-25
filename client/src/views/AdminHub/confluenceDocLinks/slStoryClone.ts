// slStoryClone.ts — Making the SL story that should already exist, from the dev story beside it.
//
// The team's own convention, and the one they follow by hand: clone the dev story, swap "[DEV]" for
// "[SL]" in the summary, and link the new story as contained in the one it came from. Doing it here
// means the pairing is identical every time, which is what lets the roll-up board nest them and the
// forecast tell dev work from test work.
//
// Pure: it builds a summary and a payload. Creating the issue and writing the link belong to the
// caller, so the convention itself is testable without Jira.

/** The tag that marks a coding story, and the one that marks its test story. */
const DEV_TAG_PATTERN = /\[dev\]/i;
const SL_TAG = '[SL]';

/**
 * The SL story's summary: the dev story's, with the tag swapped.
 *
 * ONLY the tag changes. Keeping the rest of the summary byte-identical is what makes the pair
 * recognisable — to a person scanning a board, and to `classifyChainRole`, which reads the tag and
 * nothing else. Rewording it "for clarity" would break both.
 *
 * A summary with no [DEV] tag gets the SL tag PREPENDED rather than being left untagged: an
 * untagged story is classified by its assignee, which is a guess, and this is a story whose whole
 * purpose is to be the test one.
 */
export function buildSlStorySummary(devStorySummary: string): string {
  const trimmedSummary = String(devStorySummary ?? '').trim();
  if (DEV_TAG_PATTERN.test(trimmedSummary)) {
    return trimmedSummary.replace(DEV_TAG_PATTERN, SL_TAG);
  }
  return `${SL_TAG} ${trimmedSummary}`.trim();
}

/** The fields carried across from the dev story, as the caller read them. */
export interface DevStoryFields {
  summary: string;
  projectKey: string;
  issueTypeId: string;
  /** Everything else worth inheriting: fix versions, the Feature link, the PI, and so on. */
  inheritedFields?: Record<string, unknown>;
}

/**
 * Builds the create payload for an SL story cloned from a dev story.
 *
 * Inherited fields are passed through rather than enumerated here, because which ones matter is an
 * instance question and this module must not become a second place where field ids live. What it
 * does own is the two things that are policy: the summary swap, and that the SL story is created in
 * the SAME project and of the SAME type as the story it came from — a test story filed elsewhere
 * would drop off the board that has to show it.
 */
export function buildSlStoryPayload(devStory: DevStoryFields): { fields: Record<string, unknown> } {
  return {
    fields: {
      ...(devStory.inheritedFields ?? {}),
      project: { key: devStory.projectKey },
      issuetype: { id: devStory.issueTypeId },
      summary: buildSlStorySummary(devStory.summary),
    },
  };
}

/**
 * The link that pairs the two, in the direction the board reads.
 *
 * The SL story is CONTAINED IN the dev story, so the board nests it under the card it belongs to.
 * Stated here rather than at the call site because getting the direction backwards produces a board
 * where the dev story appears nested inside its own test story, which is both wrong and confusing
 * in a way nobody reports as a bug.
 */
export interface SlContainmentLink {
  /** The story that sits inside — the new SL story. */
  innerIssueKey: string;
  /** The story that contains it — the dev story it was cloned from. */
  outerIssueKey: string;
  /** Jira's own name for the link type; the phrase varies by instance, the type name does not. */
  linkTypeName: string;
}

/** Builds the containment link for a newly created SL story. */
export function buildSlContainmentLink(
  slStoryKey: string,
  devStoryKey: string,
  linkTypeName: string,
): SlContainmentLink {
  return { innerIssueKey: slStoryKey, outerIssueKey: devStoryKey, linkTypeName };
}
