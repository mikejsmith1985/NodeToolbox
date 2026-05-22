// layoutRegression.test.ts — Guards shared layout CSS against sticky-breaking text-size scaling rules.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_LAYOUT_STYLESHEET_PATH = resolve(process.cwd(), 'src/App.module.css');
const STICKY_SAFE_ZOOM_RULE = 'zoom: var(--tool-text-zoom);';
const STICKY_BREAKING_TRANSFORM_RULE = 'transform: scale(var(--tool-text-zoom));';

describe('shared app layout styles', () => {
  it('uses zoom instead of transform for the global tool text size container', () => {
    const appLayoutStylesheetSource = readFileSync(APP_LAYOUT_STYLESHEET_PATH, 'utf8');

    expect(appLayoutStylesheetSource).toContain(STICKY_SAFE_ZOOM_RULE);
    expect(appLayoutStylesheetSource).not.toContain(STICKY_BREAKING_TRANSFORM_RULE);
  });
});
