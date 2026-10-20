// jiraEvidenceChoiceStore.ts — Remembers, per change job, which Jira files are ticked as evidence, so a resumed job keeps them.
//
// Kept beside the job's session (same zustand persist framework, its own storage key) rather than inside it, and
// cleared when the job's session is removed. Local files are not kept: a browser cannot hold them across a reload.

import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useChangeWizardSessionStore } from './changeWizardSession.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';

/** One job's choice: the ticked files (whole, so they can be fetched without listing again) and what was unticked. */
export interface JiraEvidenceChoice {
  tickedAttachments: JiraEvidenceAttachment[];
  untickedAttachmentIds: string[];
}

/** Where every job's choice is kept in this browser. */
export const JIRA_EVIDENCE_CHOICE_STORAGE_KEY = 'snowWizard:jiraEvidenceChoices';

interface JiraEvidenceChoiceState {
  choices: Record<string, JiraEvidenceChoice>;
  saveChoice: (jobId: string, choice: JiraEvidenceChoice) => void;
  forgetChoice: (jobId: string) => void;
}

/** Every change job's Jira evidence ticks, kept across reloads. */
export const useJiraEvidenceChoiceStore = create<JiraEvidenceChoiceState>()(persist((setState) => ({
  choices: {},
  saveChoice: (jobId, choice) => setState((state) => ({ choices: { ...state.choices, [jobId]: choice } })),
  forgetChoice: (jobId) => setState((state) => {
    if (!state.choices[jobId]) return state;
    const remainingChoices = { ...state.choices };
    delete remainingChoices[jobId];
    return { choices: remainingChoices };
  }),
}), { name: JIRA_EVIDENCE_CHOICE_STORAGE_KEY, storage: createJSONStorage(() => localStorage), partialize: (state) => ({ choices: state.choices }) }));

// A job that ends (its session removed) takes its ticks with it, so nothing lingers in the browser.
useChangeWizardSessionStore.subscribe((sessionState, previousSessionState) => {
  for (const jobId of Object.keys(previousSessionState.sessions)) {
    if (!sessionState.sessions[jobId]) useJiraEvidenceChoiceStore.getState().forgetChoice(jobId);
  }
});

/** The ticked files whose issue is still on the change (an issue dropped from the scope takes its files with it). */
export function readTickedJiraEvidence(choice: JiraEvidenceChoice | undefined, selectedIssueKeys: ReadonlySet<string>): JiraEvidenceAttachment[] {
  if (!choice) return [];
  return choice.tickedAttachments.filter((evidence) => selectedIssueKeys.has(evidence.issueKey));
}

/** The job's ticked Jira files that are still in scope, following the store. */
export function useTickedJiraEvidence(jobId: string, selectedIssueKeys: ReadonlySet<string>): JiraEvidenceAttachment[] {
  const choice = useJiraEvidenceChoiceStore((state) => state.choices[jobId]);
  return useMemo(() => readTickedJiraEvidence(choice, selectedIssueKeys), [choice, selectedIssueKeys]);
}
