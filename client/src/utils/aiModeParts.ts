// aiModeParts.ts — Splits an AI prompt too long for Google AI Mode's message box into messages that each fit (pure).
//
// GH #499: AI Mode — the team's only assistant — takes 2,048 characters per message and silently drops the rest, and it
// will not read an attached PDF or text file ("no response available"). It does keep a conversation, so a long prompt
// goes in as several follow-ups in ONE AI Mode chat: every part but the last asks it to reply only "READY FOR PART n",
// and the last tells it to answer using all of them. Parts are packed as full as the box allows (not halved), so the
// count stays as low as possible, and joining the parts' bodies gives back the prompt exactly — nothing is cut.

// ── Named constants ──

/** The most Google's AI Mode message box takes; what is pasted past this is silently dropped. */
export const AI_MODE_MESSAGE_CHARACTER_LIMIT = 2_048;
// Room kept below the limit in case the box counts a character differently than JavaScript does.
const SAFETY_MARGIN_CHARACTERS = 48;
// A part this full or fuller may break at a space when no line break is near its end.
const MINIMUM_FILL_BEFORE_LINE_BREAK = 0.5;
// The packing re-runs until the part count stops changing (it shifts the heading's digits by at most one place).
const MAXIMUM_PACKING_PASSES = 5;

// ── Size ──

/**
 * A message's size as the box may count it: a text box can count a line break as two characters (CR + LF), so
 * every line break is counted twice. Over-counting only costs a few characters; under-counting would lose text.
 */
export function measureAiModeMessage(messageText: string): number {
  const lineBreakCount = messageText.split('\n').length - 1;
  return messageText.length + lineBreakCount;
}

/** True when a prompt is longer than one AI Mode message takes, so it has to go in parts. */
export function isPromptTooLongForAiMode(promptText: string): boolean {
  return measureAiModeMessage(promptText) > AI_MODE_MESSAGE_CHARACTER_LIMIT;
}

// ── Part wording ──

/** The opening line of a part: part 1 explains the whole exchange, later parts stay short to leave room. */
function buildPartHeading(partNumber: number, partCount: number): string {
  if (partNumber === 1) {
    return `PART 1 OF ${partCount}. My request is too long for one message, so I am sending it in ${partCount} parts. `
      + 'Do not search and do not answer yet: after each part reply only "READY FOR PART n" (the next part\'s number). '
      + `Answer only after part ${partCount}.\n\n`;
  }
  if (partNumber === partCount) {
    return `PART ${partNumber} OF ${partCount}, the last part. You now have my whole request: answer it now, using `
      + `parts 1 to ${partCount} together and following every instruction in them.\n\n`;
  }
  return `PART ${partNumber} OF ${partCount}, continued.\n\n`;
}

/** The closing line of a part that is not the last — the instruction the assistant reads last. */
function buildPartClosing(partNumber: number, partCount: number): string {
  if (partNumber === partCount) return '';
  return `\n\n(End of part ${partNumber} of ${partCount}. Reply only "READY FOR PART ${partNumber + 1}".)`;
}

/** The most room any part's heading and closing take when there are this many parts. */
function measureLargestFrame(partCount: number): number {
  const sampleNumbers = partCount === 1 ? [1] : [1, Math.max(2, partCount - 1), partCount];
  return Math.max(...sampleNumbers.map((partNumber) => measureAiModeMessage(
    buildPartHeading(partNumber, partCount) + buildPartClosing(partNumber, partCount),
  )));
}

// ── Packing ──

/** How much of the text, from the start, fits in the size allowed (line breaks counted twice). */
function findFittingLength(text: string, allowedSize: number): number {
  let usedSize = 0;
  for (let i = 0; i < text.length; i += 1) {
    usedSize += text[i] === '\n' ? 2 : 1;
    if (usedSize > allowedSize) return i;
  }
  return text.length;
}

/** Where to end a piece: just after the last line break that fits, else the last space, else wherever it fills. */
function findBreakPoint(text: string, fittingLength: number): number {
  if (fittingLength >= text.length) return text.length;
  const fittingText = text.slice(0, fittingLength);
  const minimumBreak = Math.floor(fittingLength * MINIMUM_FILL_BEFORE_LINE_BREAK);
  const lastLineBreak = fittingText.lastIndexOf('\n');
  if (lastLineBreak >= minimumBreak) return lastLineBreak + 1;
  const lastSpace = fittingText.lastIndexOf(' ');
  if (lastSpace >= minimumBreak) return lastSpace + 1;
  return Math.max(1, fittingLength);
}

/** The prompt cut into consecutive pieces of at most the body size each; joined, they are the prompt exactly. */
function packIntoPieces(promptText: string, bodySize: number): string[] {
  const pieces: string[] = [];
  let remainingText = promptText;
  while (remainingText.length > 0) {
    const breakPoint = findBreakPoint(remainingText, findFittingLength(remainingText, bodySize));
    pieces.push(remainingText.slice(0, breakPoint));
    remainingText = remainingText.slice(breakPoint);
  }
  return pieces;
}

/** One finished part: its number, the message to paste, and the slice of the prompt it carries. */
export interface AiModePromptPart {
  partNumber: number;
  messageText: string;
  bodyText: string;
}

/**
 * The prompt as the AI Mode messages to paste, in order, into one AI Mode conversation. A prompt that fits is one part
 * with no heading; a longer one becomes parts that each fit the box, every one but the last asking for "READY".
 */
export function splitPromptForAiMode(promptText: string, messageLimit = AI_MODE_MESSAGE_CHARACTER_LIMIT): AiModePromptPart[] {
  if (measureAiModeMessage(promptText) <= messageLimit) {
    return [{ partNumber: 1, messageText: promptText, bodyText: promptText }];
  }
  const usableSize = messageLimit - SAFETY_MARGIN_CHARACTERS;
  let partCount = 2;
  let pieces: string[] = [];
  for (let pass = 0; pass < MAXIMUM_PACKING_PASSES; pass += 1) {
    pieces = packIntoPieces(promptText, Math.max(1, usableSize - measureLargestFrame(partCount)));
    if (pieces.length === partCount) break;
    partCount = pieces.length;
  }
  return pieces.map((bodyText, pieceIndex) => {
    const partNumber = pieceIndex + 1;
    const messageText = buildPartHeading(partNumber, pieces.length) + bodyText + buildPartClosing(partNumber, pieces.length);
    return { partNumber, messageText, bodyText };
  });
}

// ── Save the whole prompt to a file ──

/** A one- or two-digit number as two digits, so 9 reads as "09" in a file name. */
function padToTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The whole prompt as a plain-text file for the browser to download, named with the date and time so repeated saves
 * never overwrite one another. This is the escape hatch from AI Mode's box: a prompt saved this way can be handed to
 * an assistant that reads a file in one go, instead of being pasted part by part.
 */
export function buildAiModePromptFile(promptText: string, now: Date = new Date()): { fileName: string; blob: Blob } {
  const datePart = `${now.getFullYear()}-${padToTwoDigits(now.getMonth() + 1)}-${padToTwoDigits(now.getDate())}`;
  const timePart = `${padToTwoDigits(now.getHours())}${padToTwoDigits(now.getMinutes())}`;
  return { fileName: `ai-mode-prompt-${datePart}_${timePart}.txt`, blob: new Blob([promptText], { type: 'text/plain' }) };
}
