// AiModePromptParts — Walks the user through pasting a long AI prompt into Google AI Mode one part at a time.
//
// GH #499: AI Mode, the team's only assistant, drops everything past 2,048 characters in a message and will not read an
// attached file. It does keep a conversation, so a long prompt is sent as parts in ONE AI Mode chat (utils/aiModeParts).
// One button copies the next part and moves on, so twenty-odd parts stay manageable. The part text itself is not
// shown — the whole prompt already sits beside this panel on every surface, and a second copy would only confuse.
// A "Save prompt to file" button is the escape hatch: it downloads the whole prompt as one text file, to hand to an
// assistant that can read a file in one go instead of a chat box. Renders nothing for a prompt short enough to paste.

import { useState } from 'react';

import { AttachmentIcon, CheckIcon, ClipboardIcon } from '../AppIcons/index.tsx';
import { copyToClipboard } from '../../views/FeatureCanvas/ai/clipboard.ts';
import {
  AI_MODE_MESSAGE_CHARACTER_LIMIT, buildAiModePromptFile, isPromptTooLongForAiMode, splitPromptForAiMode,
} from '../../utils/aiModeParts.ts';
import styles from './AiModePromptParts.module.css';

// How long the browser keeps the download's temporary URL alive before it is released.
const DOWNLOAD_URL_RELEASE_MS = 10_000;

/** One built file, as the file-builder returns it. */
interface PromptFile {
  fileName: string;
  blob: Blob;
}

/** Hands a built file to the browser's own download, so it lands in the user's Downloads folder. */
function downloadPromptFile(promptFile: PromptFile): void {
  const objectUrl = URL.createObjectURL(promptFile.blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = promptFile.fileName;
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_RELEASE_MS);
}

interface AiModePromptPartsProps {
  /** The whole prompt; nothing shows when it fits one AI Mode message. */
  promptText: string;
  /** How a part reaches the clipboard; defaults to the app's shared clipboard helper. */
  writeText?: (copiedText: string) => void;
  /** How the whole-prompt file reaches the user; defaults to a browser download. */
  saveFile?: (promptFile: PromptFile) => void;
}

/** Which part is next, remembered against the prompt it belongs to so a new prompt starts again at part 1. */
interface PartProgress {
  forPromptText: string;
  nextPartIndex: number;
  lastCopiedPartIndex: number | null;
}

const NO_PROGRESS: Omit<PartProgress, 'forPromptText'> = { nextPartIndex: 0, lastCopiedPartIndex: null };

/** What to do next, given the last part copied (null before the first). */
function describeProgress(lastCopiedPartIndex: number | null, partCount: number): string {
  if (lastCopiedPartIndex === null) return `Start with part 1 of ${partCount}.`;
  const copiedPartNumber = lastCopiedPartIndex + 1;
  if (copiedPartNumber === partCount) {
    return `Part ${partCount} of ${partCount} copied — paste it into AI Mode; it answers now. Paste that answer here.`;
  }
  return `Part ${copiedPartNumber} of ${partCount} copied — paste it into AI Mode, wait for "READY FOR PART ${copiedPartNumber + 1}", then copy the next part.`;
}

/** The parts of a too-long prompt, one at a time, each with a copy button that steps on to the next. */
export function AiModePromptParts({ promptText, writeText = copyToClipboard, saveFile = downloadPromptFile }: AiModePromptPartsProps) {
  const [progress, setProgress] = useState<PartProgress>({ forPromptText: promptText, ...NO_PROGRESS });
  if (!isPromptTooLongForAiMode(promptText)) {
    return null;
  }
  const parts = splitPromptForAiMode(promptText);
  const partCount = parts.length;
  // A different prompt than the one the progress was recorded for starts over, without an effect.
  const currentProgress = progress.forPromptText === promptText ? progress : { forPromptText: promptText, ...NO_PROGRESS };
  const shownPartIndex = Math.min(currentProgress.nextPartIndex, partCount - 1);
  const shownPart = parts[shownPartIndex];
  const hasCopiedShownPart = currentProgress.lastCopiedPartIndex === shownPartIndex;

  const copyShownPart = () => {
    writeText(shownPart.messageText);
    setProgress({
      forPromptText: promptText,
      lastCopiedPartIndex: shownPartIndex,
      nextPartIndex: Math.min(shownPartIndex + 1, partCount - 1),
    });
  };
  const showPart = (partIndex: number) => setProgress({ forPromptText: promptText, nextPartIndex: partIndex, lastCopiedPartIndex: null });

  return (
    <div className={styles.promptParts} role="group" aria-label="Send the prompt to Google AI Mode in parts">
      <p className={styles.title}>Too long for one AI Mode message — send it in {partCount} parts</p>
      <p className={styles.hint}>
        AI Mode takes {AI_MODE_MESSAGE_CHARACTER_LIMIT.toLocaleString('en-US')} characters a message and drops the rest.
        Paste every part, in order, into the <strong>same</strong> AI Mode conversation. It replies "READY FOR PART …"
        until the last part, then answers — paste that answer here.
      </p>
      <p className={styles.progress} aria-live="polite">{describeProgress(currentProgress.lastCopiedPartIndex, partCount)}</p>
      <div className={styles.actions}>
        <button className={styles.button} onClick={copyShownPart} type="button">
          {hasCopiedShownPart ? <CheckIcon /> : <ClipboardIcon />} Copy part {shownPart.partNumber} of {partCount}
        </button>
        <button className={styles.linkButton} disabled={shownPartIndex === 0} onClick={() => showPart(shownPartIndex - 1)} type="button">
          Back a part
        </button>
        <button className={styles.linkButton} disabled={shownPartIndex === 0} onClick={() => showPart(0)} type="button">
          Start over
        </button>
      </div>
      <div className={styles.actions}>
        <button className={styles.button} onClick={() => saveFile(buildAiModePromptFile(promptText))} type="button">
          <AttachmentIcon /> Save prompt to file
        </button>
        <span className={styles.hint}>Saves the whole prompt as one text file — for an assistant that reads a file instead of a chat box.</span>
      </div>
    </div>
  );
}
