// AiPromptFile — Offers a long AI prompt as a file to attach, because Google AI Mode's box takes 2,048 characters.
//
// GH #499: AI Mode, the team's only assistant, silently drops everything pasted past 2,048 characters — and almost
// every prompt the app builds is longer. AI Mode can attach files, so a long prompt is downloaded as a PDF (or plain
// text) and sent with a short message. Renders nothing for a prompt short enough to paste.

import { CheckIcon, ClipboardIcon } from '../AppIcons/index.tsx';
import { useCopyFeedback } from '../../hooks/useCopyFeedback.ts';
import {
  AI_MODE_MESSAGE_CHARACTER_LIMIT,
  buildPromptFileMessage,
  buildPromptPdfBytes,
  isPromptTooLongToPaste,
} from '../../utils/promptFile.ts';
import styles from './AiPromptFile.module.css';

/** Saves a file the browser built, without asking a server — injectable for tests. */
export type PromptFileDownloader = (fileName: string, fileBlob: Blob) => void;

interface AiPromptFileProps {
  /** The whole prompt; nothing shows when it fits AI Mode's box. */
  promptText: string;
  /** The file's name without its extension, e.g. "risk-check-prompt". */
  fileBaseName: string;
  /** How the file is saved; defaults to a browser download. */
  downloadFile?: PromptFileDownloader;
}

/** Saves a blob through a temporary link — the same way the app's backups are downloaded. */
function downloadThroughLink(fileName: string, fileBlob: Blob): void {
  const objectUrl = URL.createObjectURL(fileBlob);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = fileName;
  downloadLink.click();
  URL.revokeObjectURL(objectUrl);
}

/** The steps for attaching a too-long prompt as a file in AI Mode, with its download and message buttons. */
export function AiPromptFile({ promptText, fileBaseName, downloadFile = downloadThroughLink }: AiPromptFileProps) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  if (!isPromptTooLongToPaste(promptText)) {
    return null;
  }
  const pdfFileName = `${fileBaseName}.pdf`;
  const message = buildPromptFileMessage(pdfFileName);
  const downloadPdf = () => downloadFile(pdfFileName, new Blob([buildPromptPdfBytes(promptText).slice().buffer], { type: 'application/pdf' }));
  const downloadText = () => downloadFile(`${fileBaseName}.txt`, new Blob([promptText], { type: 'text/plain' }));
  return (
    <div className={styles.promptFile} role="group" aria-label="Attach the prompt as a file">
      <p className={styles.title}>Too long to paste — attach it as a file</p>
      <p className={styles.hint}>
        Google AI Mode's message box takes {AI_MODE_MESSAGE_CHARACTER_LIMIT.toLocaleString('en-US')} characters and drops
        the rest; this prompt is {promptText.length.toLocaleString('en-US')}.
      </p>
      <ol className={styles.steps}>
        <li>
          <button className={styles.button} onClick={downloadPdf} type="button">Download the prompt (PDF)</button>
          <button className={styles.linkButton} onClick={downloadText} type="button">or as a text file</button>
        </li>
        <li>In AI Mode, attach the file you downloaded with its attach-files button.</li>
        <li>
          <button className={styles.button} onClick={() => confirmCopy(message)} type="button">
            {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy the message to send with it</>}
          </button>
          {' '}Paste it beside the file, send, then paste AI Mode's reply here.
        </li>
      </ol>
    </div>
  );
}
