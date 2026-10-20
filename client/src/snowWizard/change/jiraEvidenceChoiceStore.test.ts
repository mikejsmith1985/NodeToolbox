// jiraEvidenceChoiceStore.test.ts — Proves each job remembers which Jira files are ticked, offers only those still in scope, and forgets them when the job ends.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChangeWizardSessionStore } from './changeWizardSession.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';
import { readTickedJiraEvidence, useJiraEvidenceChoiceStore, useTickedJiraEvidence } from './jiraEvidenceChoiceStore.ts';

function buildEvidence(issueKey: string, attachmentId: string): JiraEvidenceAttachment {
  return { issueKey, issueSummary: '', attachment: { attachmentId, filename: `${attachmentId}.pdf`, sizeBytes: 1, contentUrl: '' } };
}

beforeEach(() => {
  useJiraEvidenceChoiceStore.setState({ choices: {} });
  useChangeWizardSessionStore.setState({ sessions: {} });
});

describe('jiraEvidenceChoiceStore', () => {
  it('keeps one choice per job', () => {
    const choice = { tickedAttachments: [buildEvidence('A-1', '1')], untickedAttachmentIds: ['2'] };
    useJiraEvidenceChoiceStore.getState().saveChoice('job-1', choice);
    expect(useJiraEvidenceChoiceStore.getState().choices['job-1']).toEqual(choice);
    expect(useJiraEvidenceChoiceStore.getState().choices['job-2']).toBeUndefined();
  });

  it('forgets a job’s ticks when the job itself is removed', () => {
    useChangeWizardSessionStore.getState().ensureSession('job-1', 'create');
    useJiraEvidenceChoiceStore.getState().saveChoice('job-1', { tickedAttachments: [buildEvidence('A-1', '1')], untickedAttachmentIds: [] });

    useChangeWizardSessionStore.getState().removeSession('job-1');

    expect(useJiraEvidenceChoiceStore.getState().choices['job-1']).toBeUndefined();
  });
});

describe('readTickedJiraEvidence', () => {
  it('offers only ticked files whose issue is still on the change', () => {
    const choice = { tickedAttachments: [buildEvidence('A-1', '1'), buildEvidence('A-2', '2')], untickedAttachmentIds: [] };
    expect(readTickedJiraEvidence(choice, new Set(['A-2'])).map((evidence) => evidence.attachment.attachmentId)).toEqual(['2']);
    expect(readTickedJiraEvidence(undefined, new Set(['A-2']))).toEqual([]);
  });
});

describe('useTickedJiraEvidence', () => {
  it('follows the stored ticks for the job', () => {
    const { result } = renderHook(() => useTickedJiraEvidence('job-1', new Set(['A-1'])));
    expect(result.current).toEqual([]);
    act(() => useJiraEvidenceChoiceStore.getState().saveChoice('job-1', { tickedAttachments: [buildEvidence('A-1', '1')], untickedAttachmentIds: [] }));
    expect(result.current.map((evidence) => evidence.attachment.attachmentId)).toEqual(['1']);
  });
});
