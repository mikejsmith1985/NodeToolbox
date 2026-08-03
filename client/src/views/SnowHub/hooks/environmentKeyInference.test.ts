// environmentKeyInference.test.ts — The single environment-key inference shared by the CHG
// clone and Modify flows. A REL change whose label mentions "production" must map to REL.

import { describe, expect, it } from 'vitest';

import { inferEnvironmentKeyFromValue } from './environmentKeyInference.ts';

describe('inferEnvironmentKeyFromValue', () => {
  it('maps plain REL values to rel', () => {
    expect(inferEnvironmentKeyFromValue('REL')).toBe('rel');
    expect(inferEnvironmentKeyFromValue('Release')).toBe('rel');
  });

  it('maps REL labels that also mention production to rel, not prd (user report)', () => {
    expect(inferEnvironmentKeyFromValue('Pre-Production Release')).toBe('rel');
    expect(inferEnvironmentKeyFromValue('preprod_release')).toBe('rel');
  });

  it('maps pre-production and non-production labels without "rel" to rel', () => {
    expect(inferEnvironmentKeyFromValue('Pre-Prod')).toBe('rel');
    expect(inferEnvironmentKeyFromValue('PreProd')).toBe('rel');
    expect(inferEnvironmentKeyFromValue('Non-Prod')).toBe('rel');
  });

  it('maps production values to prd', () => {
    expect(inferEnvironmentKeyFromValue('prod')).toBe('prd');
    expect(inferEnvironmentKeyFromValue('Production')).toBe('prd');
    expect(inferEnvironmentKeyFromValue('PRD')).toBe('prd');
  });

  it('maps production-fix values to pfix, ahead of everything else', () => {
    expect(inferEnvironmentKeyFromValue('PFIX')).toBe('pfix');
    expect(inferEnvironmentKeyFromValue('Production Fix')).toBe('pfix');
  });

  it('returns null for blank or unrecognised values', () => {
    expect(inferEnvironmentKeyFromValue('')).toBeNull();
    expect(inferEnvironmentKeyFromValue('   ')).toBeNull();
    expect(inferEnvironmentKeyFromValue('Staging')).toBeNull();
  });
});
