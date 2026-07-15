// themeRegression.test.ts — Guards shared styles against theme regressions in BOTH directions, and
// against the root cause behind GH #160: a stylesheet referencing a custom property that does not
// exist, so it silently and permanently renders its hardcoded fallback.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SHARED_THEME_STYLE_FILES = [
  resolve(process.cwd(), 'src/components/AppCard/AppCard.module.css'),
  resolve(process.cwd(), 'src/components/ConnectionBar/ConnectionBar.module.css'),
  resolve(process.cwd(), 'src/components/PrimaryTabs/PrimaryTabs.module.css'),
  resolve(process.cwd(), 'src/styles/global.css'),
  resolve(process.cwd(), 'src/views/AdminHub/AdminHubView.module.css'),
  resolve(process.cwd(), 'src/views/Home/HomeView.module.css'),
  resolve(process.cwd(), 'src/views/MyIssues/MyIssuesView.module.css'),
  resolve(process.cwd(), 'src/views/PoTool/FeatureCompositionTab.module.css'),
  resolve(process.cwd(), 'src/views/PoTool/FeatureSplitterTab.module.css'),
  resolve(process.cwd(), 'src/views/PoTool/PoToolView.module.css'),
  resolve(process.cwd(), 'src/views/PoTool/ai/PoAiPanel.module.css'),
  resolve(process.cwd(), 'src/views/SnowHub/components/SnowLookupField.module.css'),
  resolve(process.cwd(), 'src/views/SprintDashboard/SprintDashboardView.module.css'),
] as const;

/** Dark-only surfaces baked into a shared stylesheet break LIGHT mode. */
const DISALLOWED_DARK_THEME_SNIPPETS = [
  'rgba(13, 17, 23',
  'rgba(17, 24, 39',
  'rgba(24, 31, 45',
  '#070b12',
  '#090d14',
  'color-scheme: dark;',
] as const;

/**
 * Light-only SURFACES baked into a shared stylesheet break DARK mode — the direction that had no
 * guard, and the one that let the PO Tool ship hardcoded light in both themes (GH #160).
 *
 * Scoped to backgrounds and borders on purpose: `color: #fff` on an accent-filled button is correct
 * in both themes, so banning every white would be noise that teaches people to ignore this test.
 */
const DISALLOWED_LIGHT_THEME_PATTERNS = [
  /background(-color)?:\s*#fff(fff)?/i,
  /background(-color)?:\s*white/i,
  /border(-color)?:[^;]*#d0d7de/i,
  /background(-color)?:[^;]*#f6f8fa/i,
  /color-scheme:\s*light;/i,
] as const;

/** Where the real design tokens live; every var(--…) must resolve to one of these. */
const TOKEN_STYLE_FILES = ['src/styles/tokens.css', 'src/styles/global.css'] as const;

/** Reads every custom property NAME that the token stylesheets actually define. */
function readDefinedTokenNames(): Set<string> {
  const definedTokenNames = new Set<string>();
  for (const tokenFile of TOKEN_STYLE_FILES) {
    const tokenSource = readFileSync(resolve(process.cwd(), tokenFile), 'utf8');
    for (const declaration of tokenSource.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
      definedTokenNames.add(declaration[1]);
    }
  }
  return definedTokenNames;
}

/** Reads every custom property a stylesheet defines for its own use. */
function readLocallyDefinedTokenNames(stylesheetSource: string): Set<string> {
  return new Set([...stylesheetSource.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((declaration) => declaration[1]));
}

/** True when a var() fallback is a colour — the kind that silently pins a theme. */
function isColourFallback(fallbackValue: string): boolean {
  return /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black)\b/i.test(fallbackValue);
}

describe('shared theme styles', () => {
  it.each(SHARED_THEME_STYLE_FILES)('avoids dark-only shared surfaces in %s', (styleFileUrl) => {
    const stylesheetSource = readFileSync(styleFileUrl, 'utf8');

    for (const disallowedThemeSnippet of DISALLOWED_DARK_THEME_SNIPPETS) {
      expect(stylesheetSource).not.toContain(disallowedThemeSnippet);
    }
  });

  it.each(SHARED_THEME_STYLE_FILES)('avoids light-only shared surfaces in %s', (styleFileUrl) => {
    const stylesheetSource = readFileSync(styleFileUrl, 'utf8');

    for (const disallowedThemePattern of DISALLOWED_LIGHT_THEME_PATTERNS) {
      expect(stylesheetSource).not.toMatch(disallowedThemePattern);
    }
  });
});

// ── The root-cause guard ──
//
// The PO Tool referenced a `--tbx-*` namespace that was never defined anywhere. Every
// `var(--tbx-surface, #fff)` therefore always resolved to its light-mode fallback, so the module was
// hardcoded light in both themes while *looking* correct in light mode. Nothing caught it, because a
// missing custom property fails silently by design.
//
// Scoped to the same curated list as the guards above rather than the whole repo. A repo-wide scan
// also flags translucent tints that read fine in both themes, and vars supplied inline via style=
// (StandupBoardView's --column-accent) which a CSS-only scan cannot see. Those false positives would
// make this test noise. Other modules carry the same class of bug and are tracked separately.
describe('custom properties', () => {
  const definedTokenNames = readDefinedTokenNames();

  it('finds the token stylesheets', () => {
    // Guards the guard: a path that silently matched nothing would make this suite vacuous.
    expect(definedTokenNames.size).toBeGreaterThan(20);
  });

  it.each(SHARED_THEME_STYLE_FILES)('never falls back to a hardcoded colour for a missing token in %s', (styleFileUrl) => {
    // The exact PO Tool bug: `var(--tbx-surface, #fff)` where --tbx-surface is defined NOWHERE, so
    // the light-mode fallback wins forever — the module is theme-blind while looking correct in
    // light mode. A colour fallback on an undefined token is not a safety net; it IS the breakage.
    //
    // Deliberately narrower than "every undefined token": `var(--font-mono, monospace)` resolves to
    // a sensible non-colour default and pins no theme. Flagging it too would make this test noise,
    // and a noisy guard is one people learn to skip.
    const stylesheetSource = readFileSync(styleFileUrl, 'utf8');
    const locallyDefinedTokenNames = readLocallyDefinedTokenNames(stylesheetSource);
    const colourPinnedFallbacks: string[] = [];

    for (const reference of stylesheetSource.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,([^)]*)\)/gi)) {
      const [, referencedToken, fallbackValue] = reference;
      const isTokenDefined = definedTokenNames.has(referencedToken) || locallyDefinedTokenNames.has(referencedToken);
      if (!isTokenDefined && isColourFallback(fallbackValue)) {
        colourPinnedFallbacks.push(`var(${referencedToken},${fallbackValue})`);
      }
    }

    expect([...new Set(colourPinnedFallbacks)]).toEqual([]);
  });
});
