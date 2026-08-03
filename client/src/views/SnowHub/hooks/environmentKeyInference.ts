// environmentKeyInference.ts — Maps a ServiceNow u_environment value to a CRG environment card.
//
// This is the SINGLE inference shared by every flow that loads an existing CHG (the CRG
// clone path and the Modify CHG tab). It used to exist as two private copies that both
// checked "prod" before "rel" — so a REL change labeled "Pre-Production Release" enabled
// the PRD card instead of REL (user report). Order is now: fix → rel → pre/non-prod → prod.

/** The three environment cards a loaded change can map onto. */
export type InferredEnvironmentKey = 'rel' | 'prd' | 'pfix';

// Labels like "Pre-Prod", "PreProd", "Non-Prod" describe the release/staging environment even
// though they contain "prod" — they must never be read as production.
const PRE_OR_NON_PRODUCTION_PATTERN = /(?:pre|non)[\s_-]?prod/;

/**
 * Infers which environment card a ServiceNow environment value belongs to, or null when the
 * value is blank or matches nothing. Checks the most specific markers first: a "fix" wins
 * outright, then any release marker — including pre-/non-production phrasings — and only a
 * value with no release signal at all is treated as production.
 */
export function inferEnvironmentKeyFromValue(environmentValue: string): InferredEnvironmentKey | null {
  const normalizedEnvironmentValue = environmentValue.trim().toLowerCase();
  if (!normalizedEnvironmentValue) {
    return null;
  }

  if (normalizedEnvironmentValue.includes('pfix') || normalizedEnvironmentValue.includes('fix')) {
    return 'pfix';
  }
  if (normalizedEnvironmentValue.includes('rel') || normalizedEnvironmentValue.includes('release')) {
    return 'rel';
  }
  if (PRE_OR_NON_PRODUCTION_PATTERN.test(normalizedEnvironmentValue)) {
    return 'rel';
  }
  if (normalizedEnvironmentValue.includes('prd') || normalizedEnvironmentValue.includes('prod')) {
    return 'prd';
  }

  return null;
}
