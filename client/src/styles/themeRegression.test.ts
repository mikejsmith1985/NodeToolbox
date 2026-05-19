// themeRegression.test.ts — Guards critical shared styles against dark-only theme regressions.

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
  resolve(process.cwd(), 'src/views/SnowHub/components/SnowLookupField.module.css'),
  resolve(process.cwd(), 'src/views/SprintDashboard/SprintDashboardView.module.css'),
] as const;
const DISALLOWED_DARK_THEME_SNIPPETS = [
  'rgba(13, 17, 23',
  'rgba(17, 24, 39',
  'rgba(24, 31, 45',
  '#070b12',
  '#090d14',
  'color-scheme: dark;',
] as const;

describe('shared theme styles', () => {
  it.each(SHARED_THEME_STYLE_FILES)('avoids dark-only shared surfaces in %s', (styleFileUrl) => {
    const stylesheetSource = readFileSync(styleFileUrl, 'utf8');

    for (const disallowedThemeSnippet of DISALLOWED_DARK_THEME_SNIPPETS) {
      expect(stylesheetSource).not.toContain(disallowedThemeSnippet);
    }
  });
});
