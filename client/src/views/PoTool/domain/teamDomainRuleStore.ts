// teamDomainRuleStore.ts — Per-team "always apply these domain components" rule (spec 031, US4).
//
// Some teams always belong to a domain (e.g. both of this PO's teams are "Enrollment"), so their Features
// should always carry the team's domain component(s) — set DETERMINISTICALLY, never by AI, and never
// story-generating (the repo-only story rule guarantees that). This store holds the rule keyed by the saved
// Dashboard Team profile id (the identity the PO Tool / PI Planner already select). A rule entry that names
// a component classified `repo` or one that is unclassified is FLAGGED rather than applied, so a repo can
// never be silently applied as a domain tag.

import { create } from 'zustand';

import type { ComponentKind } from '../../AdminHub/lib/componentClassificationStore.ts';

const TEAM_DOMAIN_RULES_STORAGE_KEY = 'tbxTeamDomainRules';

interface TeamDomainRuleState {
  /** teamProfileId → the domain component names always applied to that team's Features. */
  rulesByTeam: Record<string, string[]>;
}

/** Why a configured rule entry could not be applied. */
export interface FlaggedDomainComponent {
  name: string;
  reason: string;
}

/** The result of validating a team's rule against the current classification. */
export interface DomainRuleValidation {
  /** Names that are genuinely classified `domain` — safe to apply. */
  valid: string[];
  /** Names that are a repo, or not classified — held back, not applied. */
  flagged: FlaggedDomainComponent[];
}

function readStoredRules(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(TEAM_DOMAIN_RULES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const result: Record<string, string[]> = {};
    for (const [teamProfileId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[teamProfileId] = value.filter((entry): entry is string => typeof entry === 'string');
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeStoredRules(rulesByTeam: Record<string, string[]>): void {
  try {
    localStorage.setItem(TEAM_DOMAIN_RULES_STORAGE_KEY, JSON.stringify(rulesByTeam));
  } catch {
    // In-memory state stays authoritative in private-mode browsers.
  }
}

export const useTeamDomainRuleStore = create<TeamDomainRuleState>(() => ({
  rulesByTeam: readStoredRules(),
}));

/** Replaces a team's domain-component list (de-duplicated, blanks dropped). */
export function setTeamDomainComponents(teamProfileId: string, names: readonly string[]): void {
  if (teamProfileId.trim() === '') {
    return;
  }
  const cleaned = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
  const rulesByTeam = { ...useTeamDomainRuleStore.getState().rulesByTeam, [teamProfileId]: cleaned };
  writeStoredRules(rulesByTeam);
  useTeamDomainRuleStore.setState({ rulesByTeam });
}

/** The domain component names configured for a team (empty when none). */
export function getTeamDomainComponents(teamProfileId: string): string[] {
  return useTeamDomainRuleStore.getState().rulesByTeam[teamProfileId] ?? [];
}

/**
 * Splits a team's configured domain components into those safe to apply (classified `domain`) and those
 * held back (a repo, or not classified) — so a repo can never be applied as a domain tag (FR-032). A
 * nonexistent Jira component surfaces later as an unresolved name when the valid set is written.
 */
export function validateTeamDomainRule(
  teamProfileId: string,
  getKind: (name: string) => ComponentKind | null,
): DomainRuleValidation {
  const valid: string[] = [];
  const flagged: FlaggedDomainComponent[] = [];
  for (const name of getTeamDomainComponents(teamProfileId)) {
    const kind = getKind(name);
    if (kind === 'domain') {
      valid.push(name);
    } else if (kind === 'repo') {
      flagged.push({ name, reason: 'classified as a repo — a repo cannot be applied as a domain tag' });
    } else {
      flagged.push({ name, reason: 'not classified as a domain component' });
    }
  }
  return { valid, flagged };
}
