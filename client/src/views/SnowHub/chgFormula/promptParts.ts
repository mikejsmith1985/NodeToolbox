// promptParts.ts — Splits a prompt too long for an AI chat box into parts that each fit (pure): halved at a line break,
// and halved again, until every part is under the limit. Every part but the last tells the assistant to wait, so it
// answers once, with the whole request in front of it.
//
// Owner, GH #475: a change's prompt came to 134,856 characters and Copilot refuses a message over 128,000. Nothing is
// cut or dropped — the chat's own history holds all the parts; only one message at a time has to fit.
//
// GH #499: the team's only assistant is now Google's AI Mode, which publishes no limit and fails quietly. A 49,679-
// character Risk Check was read only to its first ~2,000 characters ("your prompt was cut off"), while AI Draft prompts
// of 22,000 characters and more were read whole. Gemini's own chat box is reported to take about 30,000, so parts are
// held under that, with room to spare.

/** The most one message is trusted to carry in Google's AI Mode — what its AI Draft prompts have been read whole at. */
export const ASSISTANT_PROMPT_CHARACTER_LIMIT = 25_000;
/** What each part is held to: under the limit, with room for the part's own heading and a line the user adds. */
export const PROMPT_PART_CHARACTER_BUDGET = 24_000;
// Room kept in every part for its heading and closing line.
const PART_FRAME_ALLOWANCE = 600;

/** The opening lines of one part. */
function buildPartHeading(partNumber: number, partCount: number): string {
  if (partNumber === partCount) {
    return `PART ${partNumber} OF ${partCount} — the last part. You now have the whole request: answer it now, using everything in parts 1 to ${partCount} together.`;
  }
  return `PART ${partNumber} OF ${partCount} — this request is too long for one message, so it comes in ${partCount} parts. `
    + `Read this part and keep it in mind. Do not answer yet: reply only with "READY FOR PART ${partNumber + 1}".`;
}

/** The closing line of a part that is not the last. */
function buildPartClosing(partNumber: number, partCount: number): string {
  return `(End of part ${partNumber} of ${partCount}. Reply only with "READY FOR PART ${partNumber + 1}".)`;
}

/** Where to halve a piece of text: the line break nearest its middle, or the middle itself for one long line. */
function findHalvingPoint(text: string): number {
  const middle = Math.floor(text.length / 2);
  const breakBefore = text.lastIndexOf('\n', middle);
  const breakAfter = text.indexOf('\n', middle);
  const candidates = [breakBefore, breakAfter].filter((breakIndex) => breakIndex > 0 && breakIndex < text.length - 1);
  if (candidates.length === 0) return middle;
  return candidates.reduce((nearest, breakIndex) => (Math.abs(breakIndex - middle) < Math.abs(nearest - middle) ? breakIndex : nearest));
}

/** The text halved, and each half halved again, until every piece is within the size. */
function halveUntilFits(text: string, pieceSize: number): string[] {
  if (text.length <= pieceSize) return [text];
  const halvingPoint = findHalvingPoint(text);
  return [...halveUntilFits(text.slice(0, halvingPoint), pieceSize), ...halveUntilFits(text.slice(halvingPoint).replace(/^\n/, ''), pieceSize)];
}

/**
 * The prompt as the messages to paste, in order: just the prompt when it fits in one, otherwise parts that each fit,
 * every one headed "PART n OF N", and all but the last asking the assistant to wait for the next.
 */
export function splitPromptIntoParts(promptText: string, partBudget = PROMPT_PART_CHARACTER_BUDGET): string[] {
  if (promptText.length <= partBudget) return [promptText];
  const pieces = halveUntilFits(promptText, Math.max(1, partBudget - PART_FRAME_ALLOWANCE));
  return pieces.map((piece, pieceIndex) => {
    const partNumber = pieceIndex + 1;
    const closing = partNumber < pieces.length ? ['', buildPartClosing(partNumber, pieces.length)] : [];
    return [buildPartHeading(partNumber, pieces.length), '', piece, ...closing].join('\n');
  });
}

/** What to tell the user when a prompt comes in parts, or '' when it is one message. */
export function describePromptParts(partCount: number): string {
  if (partCount < 2) return '';
  return `This prompt is too long for one AI chat message, so it comes in ${partCount} parts. Paste them in order into `
    + 'the same chat — the assistant answers "READY" to each until the last — then paste its final answer below.';
}
