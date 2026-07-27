// useMyIssuesPersonaStore.ts — The TOOL-WIDE "simulate as" subject for My Issues.
//
// The persona (view as the signed-in user, a simulated user, or a team) used to live inside
// useMyIssuesState and only affected the Report tab's issue list. This shared store lifts it so every
// honored tab — Today, Report, Mentions, Hygiene — reads one "viewing as {X}" subject. It is read-only
// simulation: it only re-points what each tab QUERIES; it never writes on the simulated person's behalf.
// Session-only (in-memory) — reloading returns to the real viewer, which is the right default for a
// transient "look at what someone else sees" action.

import { create } from 'zustand';

import type { ReportSubject } from '../myIssuesRoleLens.ts';

interface MyIssuesPersonaState {
  /** Who the tool is currently viewing as. Defaults to the signed-in viewer. */
  subject: ReportSubject;
  /** Resolved roster member identifiers for a `team` subject (empty otherwise). */
  memberIdentifiers: string[];
}

export const useMyIssuesPersonaStore = create<MyIssuesPersonaState>(() => ({
  subject: { kind: 'viewer' },
  memberIdentifiers: [],
}));

/** Sets the tool-wide persona subject. Member identifiers are kept only for a team subject. */
export function setMyIssuesPersonaSubject(subject: ReportSubject, memberIdentifiers: string[] = []): void {
  useMyIssuesPersonaStore.setState({
    subject,
    memberIdentifiers: subject.kind === 'team' ? memberIdentifiers : [],
  });
}
