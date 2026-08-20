// deployEnvironments.test.ts — The branch-to-environment ladder.
//
// The GitHub Deployments API is unreachable from this network (an org IP allow list returns 403,
// GH #375), but the merge emails already arriving say "Merged #967 into prd." — so the target
// branch IS the deployment signal, and it was being thrown away.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DEPLOY_LADDER,
  compareDeployRank,
  readDeployEnvironment,
  buildEnvironmentMergeRules,
  resolveDeployLadder,
} from './deployEnvironments.ts'

describe('readDeployEnvironment', () => {
  it('names the environment a merge target belongs to', () => {
    expect(readDeployEnvironment('dev', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('dev')
    expect(readDeployEnvironment('int', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('int')
    expect(readDeployEnvironment('rel', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('rel')
    expect(readDeployEnvironment('prd', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('prd')
  })

  it('ignores case and surrounding whitespace, as an email body will carry both', () => {
    expect(readDeployEnvironment('  PRD ', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('prd')
  })

  it('matches a documented alternative spelling of the same branch', () => {
    expect(readDeployEnvironment('production', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('prd')
    expect(readDeployEnvironment('release', DEFAULT_DEPLOY_LADDER)?.environmentId).toBe('rel')
  })

  it('returns null for a feature branch rather than guessing an environment', () => {
    expect(readDeployEnvironment('feature/ENFCT-1690-add-facets', DEFAULT_DEPLOY_LADDER)).toBeNull()
    expect(readDeployEnvironment(null, DEFAULT_DEPLOY_LADDER)).toBeNull()
    expect(readDeployEnvironment('', DEFAULT_DEPLOY_LADDER)).toBeNull()
  })
})

describe('compareDeployRank — the ladder is also the forward-only guard', () => {
  it('orders the environments dev before int before rel before prd', () => {
    expect(compareDeployRank('dev', 'int', DEFAULT_DEPLOY_LADDER)).toBeLessThan(0)
    expect(compareDeployRank('int', 'rel', DEFAULT_DEPLOY_LADDER)).toBeLessThan(0)
    expect(compareDeployRank('rel', 'prd', DEFAULT_DEPLOY_LADDER)).toBeLessThan(0)
  })

  it('reports a backwards move so a story in INT is never dragged back to SL', () => {
    expect(compareDeployRank('prd', 'int', DEFAULT_DEPLOY_LADDER)).toBeGreaterThan(0)
  })

  it('treats an unknown environment as incomparable rather than as the earliest', () => {
    // Ranking an unknown at zero would silently make every real environment a "forward" move.
    expect(compareDeployRank('nonsense', 'int', DEFAULT_DEPLOY_LADDER)).toBeNull()
    expect(compareDeployRank('int', 'nonsense', DEFAULT_DEPLOY_LADDER)).toBeNull()
  })
})

describe('resolveDeployLadder — the branch names are the team\'s, not ours', () => {
  it('uses the default ladder when nothing is configured', () => {
    expect(resolveDeployLadder(undefined)).toEqual(DEFAULT_DEPLOY_LADDER)
    expect(resolveDeployLadder([])).toEqual(DEFAULT_DEPLOY_LADDER)
  })

  it('takes a configured ladder whole, so a team can rename or drop a rung', () => {
    const ladder = resolveDeployLadder([
      { environmentId: 'int', label: 'INT', branchNames: ['integration'] },
      { environmentId: 'prd', label: 'PROD', branchNames: ['main'] },
    ])

    expect(ladder).toHaveLength(2)
    expect(readDeployEnvironment('integration', ladder)?.environmentId).toBe('int')
    expect(readDeployEnvironment('dev', ladder)).toBeNull()
    expect(compareDeployRank('int', 'prd', ladder)).toBeLessThan(0)
  })

  it('ignores a configured rung that names no branch, rather than matching everything', () => {
    const ladder = resolveDeployLadder([
      { environmentId: 'int', label: 'INT', branchNames: [] },
      { environmentId: 'prd', label: 'PROD', branchNames: ['prd'] },
    ])

    expect(ladder).toHaveLength(1)
    expect(ladder[0].environmentId).toBe('prd')
  })
})

describe('buildEnvironmentMergeRules — one rule per rung, so each deploy is separately configurable', () => {
  it('emits a rule per environment, ahead of the generic merge rule', () => {
    const rules = buildEnvironmentMergeRules(DEFAULT_DEPLOY_LADDER)

    expect(rules.map((rule) => rule.id)).toEqual([
      'pr-merged-dev', 'pr-merged-int', 'pr-merged-rel', 'pr-merged-prd',
    ])
    expect(rules.every((rule) => rule.eventType === 'pr_merged')).toBe(true)
    expect(rules.every((rule) => rule.requiresPrNumber === true)).toBe(true)
  })

  it('matches only its own environment, so a dev merge never fires the prod rule', () => {
    const [devRule, , , prdRule] = buildEnvironmentMergeRules(DEFAULT_DEPLOY_LADDER)

    expect(devRule.bodyMarker?.test('Merged #2885 into dev.')).toBe(true)
    expect(prdRule.bodyMarker?.test('Merged #2885 into dev.')).toBe(false)
    expect(prdRule.bodyMarker?.test('Merged #967 into prd.')).toBe(true)
  })

  it('matches every spelling its rung lists', () => {
    const [, , , prdRule] = buildEnvironmentMergeRules(DEFAULT_DEPLOY_LADDER)

    expect(prdRule.bodyMarker?.test('Merged #1 into production.')).toBe(true)
    expect(prdRule.bodyMarker?.test('Merged #1 into prod.')).toBe(true)
  })

  it('does not match a branch that merely starts with an environment name', () => {
    // "development-spike" is a feature branch. Without an anchored end it would read as a dev deploy.
    const [devRule] = buildEnvironmentMergeRules(DEFAULT_DEPLOY_LADDER)

    expect(devRule.bodyMarker?.test('Merged #1 into development-spike.')).toBe(false)
  })

  it('does not fire on a pull request merely opened against an environment branch', () => {
    const [, , , prdRule] = buildEnvironmentMergeRules(DEFAULT_DEPLOY_LADDER)

    expect(prdRule.bodyMarker?.test('wants to merge 3 commits into prd from feature/X')).toBe(false)
  })
})
