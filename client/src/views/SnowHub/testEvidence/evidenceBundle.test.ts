// evidenceBundle.test.ts — Deciding what goes into a test-evidence bundle, and what it is called.

import { describe, expect, it } from 'vitest';

import {
  buildEvidenceArchiveName,
  formatByteSize,
  MAX_ATTACHABLE_BUNDLE_BYTES,
  planEvidenceBundle,
  type EvidenceIssue,
} from './evidenceBundle.ts';

const GENERATED_AT = new Date('2026-09-05T14:30:00Z');

function attachment(overrides: Partial<EvidenceIssue['attachments'][number]> = {}) {
  return {
    attachmentId: '1001',
    filename: 'regression-run.pdf',
    sizeBytes: 2048,
    mimeType: 'application/pdf',
    created: '2026-09-01T10:00:00.000+0000',
    authorName: 'Ramirez, Dana',
    contentUrl: 'https://jira.example.com/secure/attachment/1001/regression-run.pdf',
    ...overrides,
  };
}

function issue(key: string, attachments: EvidenceIssue['attachments'], summary = `Summary ${key}`): EvidenceIssue {
  return { key, summary, attachments };
}

describe('buildEvidenceArchiveName', () => {
  it('names the file for what it is: test evidence, for this change, on this day', () => {
    expect(buildEvidenceArchiveName('CHG0041298', GENERATED_AT)).toBe('Test-Evidence_CHG0041298_2026-09-05.zip');
  });

  it('never lets a hostile change number become a path', () => {
    expect(buildEvidenceArchiveName('../CHG/1', GENERATED_AT)).toBe('Test-Evidence_.._CHG_1_2026-09-05.zip');
  });
});

describe('planEvidenceBundle', () => {
  it('files every attachment under its own issue key', () => {
    const plan = planEvidenceBundle({
      changeNumber: 'CHG0041298',
      issues: [issue('ENCUC-2213', [attachment()]), issue('ENCUC-2358', [attachment({ attachmentId: '1002', filename: 'screens.png' })])],
      generatedAt: GENERATED_AT,
    });

    expect(plan.entries.map((entry) => entry.archivePath)).toEqual([
      'ENCUC-2213/regression-run.pdf',
      'ENCUC-2358/screens.png',
    ]);
  });

  it('keeps two same-named files on one issue apart by attachment id rather than overwriting one', () => {
    // Jira happily holds two "evidence.png" on one issue; a zip cannot.
    const plan = planEvidenceBundle({
      changeNumber: 'CHG1',
      issues: [issue('ENCUC-1', [
        attachment({ attachmentId: '7', filename: 'evidence.png' }),
        attachment({ attachmentId: '8', filename: 'evidence.png' }),
      ])],
      generatedAt: GENERATED_AT,
    });

    expect(plan.entries.map((entry) => entry.archivePath)).toEqual([
      'ENCUC-1/evidence.png',
      'ENCUC-1/evidence (8).png',
    ]);
  });

  it('replaces characters a zip path cannot carry, without losing the extension', () => {
    const plan = planEvidenceBundle({
      changeNumber: 'CHG1',
      issues: [issue('ENCUC-1', [attachment({ filename: 'run: results/final?.xlsx' })])],
      generatedAt: GENERATED_AT,
    });

    expect(plan.entries[0].archivePath).toBe('ENCUC-1/run_ results_final_.xlsx');
  });

  it('orders by issue key then filename so the archive reads like the release', () => {
    const plan = planEvidenceBundle({
      changeNumber: 'CHG1',
      issues: [
        issue('ENCUC-9', [attachment({ attachmentId: '3', filename: 'b.png' }), attachment({ attachmentId: '2', filename: 'a.png' })]),
        issue('ENCUC-10', [attachment({ attachmentId: '1', filename: 'z.png' })]),
      ],
      generatedAt: GENERATED_AT,
    });

    expect(plan.entries.map((entry) => entry.archivePath)).toEqual([
      'ENCUC-9/a.png',
      'ENCUC-9/b.png',
      'ENCUC-10/z.png',
    ]);
  });

  it('totals the bytes and names the issues that brought nothing', () => {
    // An issue with no evidence is a fact the reviewer needs, not a row to drop.
    const plan = planEvidenceBundle({
      changeNumber: 'CHG1',
      issues: [issue('ENCUC-1', [attachment({ sizeBytes: 100 }), attachment({ attachmentId: '2', filename: 'b', sizeBytes: 250 })]), issue('ENCUC-2', [])],
      generatedAt: GENERATED_AT,
    });

    expect(plan.totalBytes).toBe(350);
    expect(plan.fileCount).toBe(2);
    expect(plan.issuesWithoutAttachments).toEqual(['ENCUC-2']);
  });

  it('writes a manifest a reviewer can read without opening anything else', () => {
    const plan = planEvidenceBundle({
      changeNumber: 'CHG0041298',
      releaseLabel: 'ENCUC 2026.09.1',
      issues: [issue('ENCUC-2213', [attachment()], 'Enrollment feed uplift'), issue('ENCUC-2358', [])],
      generatedAt: GENERATED_AT,
    });

    expect(plan.manifestPath).toBe('MANIFEST.txt');
    expect(plan.manifestText).toContain('Test evidence for release ENCUC 2026.09.1 (CHG0041298)');
    expect(plan.manifestText).toContain('Generated 2026-09-05T14:30:00.000Z');
    expect(plan.manifestText).toContain('ENCUC-2213 — Enrollment feed uplift');
    expect(plan.manifestText).toContain('  regression-run.pdf  2.0 KB  Ramirez, Dana  2026-09-01');
    expect(plan.manifestText).toContain('ENCUC-2358 — Summary ENCUC-2358');
    expect(plan.manifestText).toContain('  (no attachments)');
  });

  it('falls back to the change number when no release label is known', () => {
    const plan = planEvidenceBundle({ changeNumber: 'CHG7', issues: [], generatedAt: GENERATED_AT });

    expect(plan.manifestText).toContain('Test evidence for release CHG7');
    expect(plan.archiveName).toBe('Test-Evidence_CHG7_2026-09-05.zip');
  });

  it('says when the bundle is too big to push through the relay', () => {
    const plan = planEvidenceBundle({
      changeNumber: 'CHG1',
      issues: [issue('ENCUC-1', [attachment({ sizeBytes: MAX_ATTACHABLE_BUNDLE_BYTES + 1 })])],
      generatedAt: GENERATED_AT,
    });

    expect(plan.isTooLargeToAttach).toBe(true);
  });
});

describe('formatByteSize', () => {
  it('reads the way a person says it', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(900)).toBe('900 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
