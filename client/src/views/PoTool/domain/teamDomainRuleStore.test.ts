// teamDomainRuleStore.test.ts — Per-team domain-component rule (spec 031, US4).

import { beforeEach, describe, expect, it } from 'vitest';

import type { ComponentKind } from '../../AdminHub/lib/componentClassificationStore.ts';
import {
  getTeamDomainComponents,
  setTeamDomainComponents,
  useTeamDomainRuleStore,
  validateTeamDomainRule,
} from './teamDomainRuleStore.ts';

beforeEach(() => {
  window.localStorage.clear();
  useTeamDomainRuleStore.setState({ rulesByTeam: {} });
});

/** payments-api is a repo, Enrollment is a domain, everything else is unclassified. */
const getKind = (name: string): ComponentKind | null =>
  (name === 'payments-api' ? 'repo' : name === 'Enrollment' ? 'domain' : null);

describe('teamDomainRuleStore', () => {
  it('sets and reads a team\'s domain components, de-duplicated', () => {
    setTeamDomainComponents('team-1', ['Enrollment', 'Enrollment', '  ']);
    expect(getTeamDomainComponents('team-1')).toEqual(['Enrollment']);
    expect(getTeamDomainComponents('team-2')).toEqual([]);
  });

  it('persists to the tbxTeamDomainRules key', () => {
    setTeamDomainComponents('team-1', ['Enrollment']);
    const stored = JSON.parse(window.localStorage.getItem('tbxTeamDomainRules') ?? '{}');
    expect(stored['team-1']).toEqual(['Enrollment']);
  });

  it('validates: a domain name is valid; a repo or unclassified name is flagged', () => {
    setTeamDomainComponents('team-1', ['Enrollment', 'payments-api', 'mystery']);
    const result = validateTeamDomainRule('team-1', getKind);
    expect(result.valid).toEqual(['Enrollment']);
    expect(result.flagged.map((f) => f.name)).toEqual(['payments-api', 'mystery']);
    expect(result.flagged[0].reason).toMatch(/repo/);
    expect(result.flagged[1].reason).toMatch(/not classified/);
  });
});
