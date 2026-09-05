// evidenceBundle.ts — Planning a test-evidence bundle: which Jira attachments go where in the zip.
//
// Pure on purpose. It receives attachment metadata as data and decides names, paths, order and the
// manifest; nothing here talks to Jira or ServiceNow. That keeps the decisions a reviewer will
// actually argue about — "why is this file called that?" — testable without either system.

/** One attachment as Jira described it, before any bytes are fetched. */
export interface EvidenceAttachment {
  attachmentId: string;
  filename: string;
  sizeBytes: number;
  mimeType?: string;
  created?: string;
  authorName?: string;
  /** The absolute URL Jira serves the file from; the fetch layer turns it into a proxy path. */
  contentUrl: string;
}

/** One issue in the release and everything attached to it. */
export interface EvidenceIssue {
  key: string;
  summary: string;
  attachments: EvidenceAttachment[];
}

/** Where one attachment lands inside the archive. */
export interface EvidenceEntryPlan {
  issueKey: string;
  attachment: EvidenceAttachment;
  archivePath: string;
}

/** The whole bundle, decided but not yet built. */
export interface EvidenceBundlePlan {
  archiveName: string;
  entries: EvidenceEntryPlan[];
  manifestPath: string;
  manifestText: string;
  fileCount: number;
  totalBytes: number;
  issuesWithoutAttachments: string[];
  /** True when the bytes exceed what the browser relay can carry to ServiceNow in one request. */
  isTooLargeToAttach: boolean;
}

export interface EvidenceBundleInput {
  changeNumber: string;
  /** Human name of the release (fix version) when known; the change number stands in otherwise. */
  releaseLabel?: string;
  issues: EvidenceIssue[];
  generatedAt: Date;
}

/**
 * The most a bundle may weigh and still be attached from the browser.
 *
 * The relay carries the file as base64 inside a JSON envelope, so 75 MB of zip becomes ~100 MB of
 * request. Past that the round trip is slow enough to look hung, and ServiceNow instances commonly
 * cap a single attachment near this size anyway. A bigger bundle can still be downloaded.
 */
export const MAX_ATTACHABLE_BUNDLE_BYTES = 75 * 1024 * 1024;

const ARCHIVE_NAME_PREFIX = 'Test-Evidence';
const ARCHIVE_EXTENSION = '.zip';
const MANIFEST_PATH = 'MANIFEST.txt';
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Characters no zip path (or Windows extractor) tolerates. */
const UNSAFE_PATH_CHARACTERS = /[\\/:*?"<>|]/g;
/** Code points at or below this are control characters, which have no place in a file name. */
const HIGHEST_CONTROL_CODE_POINT = 31;
const PATH_REPLACEMENT = '_';
const ISO_DATE_LENGTH = 10;

/** Makes any text safe as one path segment: no separators, no reserved or control characters. */
function sanitizePathSegment(rawText: string): string {
  const withoutControls = Array.from(String(rawText ?? ''))
    .filter((character) => character.charCodeAt(0) > HIGHEST_CONTROL_CODE_POINT)
    .join('');
  const cleaned = withoutControls.replace(UNSAFE_PATH_CHARACTERS, PATH_REPLACEMENT).trim();
  return cleaned === '' ? PATH_REPLACEMENT : cleaned;
}

/** Splits "report.final.pdf" into "report.final" + ".pdf"; a dotless name keeps an empty extension. */
function splitExtension(filename: string): { stem: string; extension: string } {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { stem: filename, extension: '' };
  }
  return { stem: filename.slice(0, dotIndex), extension: filename.slice(dotIndex) };
}

/**
 * The archive's file name: what it is, which change, which day.
 *
 * The change number is sanitized because it becomes part of a file name that ServiceNow and the
 * operator's downloads folder will both hold.
 */
export function buildEvidenceArchiveName(changeNumber: string, generatedAt: Date): string {
  const dayStamp = generatedAt.toISOString().slice(0, ISO_DATE_LENGTH);
  return `${ARCHIVE_NAME_PREFIX}_${sanitizePathSegment(changeNumber)}_${dayStamp}${ARCHIVE_EXTENSION}`;
}

/** Formats bytes the way a person reads them, with one decimal past kilobytes. */
export function formatByteSize(byteCount: number): string {
  if (byteCount >= BYTES_PER_MEGABYTE) {
    return `${(byteCount / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
  }
  if (byteCount >= BYTES_PER_KILOBYTE) {
    return `${(byteCount / BYTES_PER_KILOBYTE).toFixed(1)} KB`;
  }
  return `${byteCount} B`;
}

/** Natural order for issue keys: by project, then by number — so ENCUC-9 precedes ENCUC-10. */
function compareIssueKeys(leftKey: string, rightKey: string): number {
  const [leftProject, leftNumber] = leftKey.split('-');
  const [rightProject, rightNumber] = rightKey.split('-');
  if (leftProject !== rightProject) {
    return leftProject.localeCompare(rightProject);
  }
  return Number(leftNumber) - Number(rightNumber);
}

/**
 * Decides the archive path of every attachment on one issue.
 *
 * Two attachments with the same name on one issue are both real evidence, so the second is kept
 * apart by its attachment id rather than silently overwriting the first.
 */
function planIssueEntries(evidenceIssue: EvidenceIssue): EvidenceEntryPlan[] {
  const issueFolder = sanitizePathSegment(evidenceIssue.key);
  const usedPaths = new Set<string>();
  const sortedAttachments = [...evidenceIssue.attachments]
    .sort((left, right) => left.filename.localeCompare(right.filename));

  return sortedAttachments.map((evidenceAttachment) => {
    const safeName = sanitizePathSegment(evidenceAttachment.filename);
    let archivePath = `${issueFolder}/${safeName}`;
    if (usedPaths.has(archivePath)) {
      const { stem, extension } = splitExtension(safeName);
      archivePath = `${issueFolder}/${stem} (${evidenceAttachment.attachmentId})${extension}`;
    }
    usedPaths.add(archivePath);
    return { issueKey: evidenceIssue.key, attachment: evidenceAttachment, archivePath };
  });
}

/** One manifest line per attachment: name, size, who, when. */
function formatManifestAttachmentLine(evidenceAttachment: EvidenceAttachment): string {
  const createdDay = (evidenceAttachment.created ?? '').slice(0, ISO_DATE_LENGTH);
  return [
    `  ${evidenceAttachment.filename}`,
    formatByteSize(evidenceAttachment.sizeBytes),
    evidenceAttachment.authorName ?? '',
    createdDay,
  ].filter((part) => part !== '').join('  ');
}

/** The MANIFEST.txt body: a reviewer can read what is here without opening anything else. */
function buildManifestText(input: EvidenceBundleInput, sortedIssues: EvidenceIssue[], fileCount: number): string {
  const releaseLabel = (input.releaseLabel ?? '').trim();
  const headline = releaseLabel === ''
    ? `Test evidence for release ${input.changeNumber}`
    : `Test evidence for release ${releaseLabel} (${input.changeNumber})`;

  const issueBlocks = sortedIssues.map((evidenceIssue) => {
    const attachmentLines = evidenceIssue.attachments.length === 0
      ? ['  (no attachments)']
      : [...evidenceIssue.attachments]
        .sort((left, right) => left.filename.localeCompare(right.filename))
        .map(formatManifestAttachmentLine);
    return [`${evidenceIssue.key} — ${evidenceIssue.summary}`, ...attachmentLines].join('\n');
  });

  return [
    headline,
    `Generated ${input.generatedAt.toISOString()}`,
    `${sortedIssues.length} issue(s), ${fileCount} file(s)`,
    '',
    ...issueBlocks,
    '',
  ].join('\n');
}

/**
 * Plans the whole bundle from the attachment metadata Jira reported.
 *
 * Nothing is fetched here: the plan says what the archive WOULD contain and how big it would be,
 * which is what the operator needs to see before choosing to build it.
 */
export function planEvidenceBundle(input: EvidenceBundleInput): EvidenceBundlePlan {
  const sortedIssues = [...input.issues].sort((left, right) => compareIssueKeys(left.key, right.key));
  const entries = sortedIssues.flatMap(planIssueEntries);
  const totalBytes = entries.reduce((runningTotal, entry) => runningTotal + entry.attachment.sizeBytes, 0);

  return {
    archiveName: buildEvidenceArchiveName(input.changeNumber, input.generatedAt),
    entries,
    manifestPath: MANIFEST_PATH,
    manifestText: buildManifestText(input, sortedIssues, entries.length),
    fileCount: entries.length,
    totalBytes,
    issuesWithoutAttachments: sortedIssues
      .filter((evidenceIssue) => evidenceIssue.attachments.length === 0)
      .map((evidenceIssue) => evidenceIssue.key),
    isTooLargeToAttach: totalBytes > MAX_ATTACHABLE_BUNDLE_BYTES,
  };
}
