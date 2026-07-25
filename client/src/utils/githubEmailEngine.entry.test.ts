// githubEmailEngine.entry.test.ts — Guards the server bundle's public API. This barrel is what esbuild
// bundles to CJS for the Node intake scheduler; a dropped/renamed re-export would break it at runtime.

import { describe, expect, it } from 'vitest';

import * as engine from './githubEmailEngine.entry.ts';

describe('githubEmailEngine.entry (server bundle barrel)', () => {
  it('re-exports every pure function the server-side intake needs', () => {
    for (const requiredExport of ['parseMime', 'getHeader', 'classifyGithubEmail', 'parseGithubEmail', 'isProcessed', 'findProcessed', 'appendProcessed']) {
      expect(typeof (engine as unknown as Record<string, unknown>)[requiredExport]).toBe('function');
    }
    expect(Array.isArray(engine.GITHUB_EMAIL_RULES)).toBe(true);
  });

  it('classifies a merge email end-to-end through the barrel', () => {
    const raw = [
      'List-ID: myorg/toolbox <toolbox.myorg.github.com>',
      'Subject: [myorg/toolbox] Add (#123)',
      'Message-ID: <x@github.com>',
      'Content-Type: text/plain',
      '',
      'Merged #123 into main from feature/DENP-1414.',
    ].join('\r\n');
    const event = engine.parseGithubEmail(raw);
    expect(event.eventType).toBe('pr_merged');
    expect(event.jiraKey).toBe('DENP-1414');
  });
});
