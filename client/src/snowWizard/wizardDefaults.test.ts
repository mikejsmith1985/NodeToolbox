// wizardDefaults.test.ts — Proves the Wizard's built-in addresses are the agreed ones and match Toolbox's own default.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_JIRA_URL, DEFAULT_SNOW_URL, WIZARD_CHANNEL_NAME, WIZARD_PRESENCE_LOCK_NAME } from './wizardDefaults.ts';

describe('wizardDefaults', () => {
  it('uses the ServiceNow address the owner gave (GH #449)', () => {
    expect(DEFAULT_SNOW_URL).toBe('https://zilverton.service-now.com');
  });

  it('pre-fills Jira with the same default Toolbox ships, so the two never disagree', () => {
    const toolboxConfigLoader = readFileSync(resolve(__dirname, '../../../src/config/loader.js'), 'utf8');
    expect(toolboxConfigLoader).toContain(`baseUrl:  '${DEFAULT_JIRA_URL}'`);
  });

  it('talks on a channel distinct from the probe\'s', () => {
    expect(WIZARD_CHANNEL_NAME).toBe('snowWizard');
  });

  it('names one presence lock shared by the bookmark and the Wizard window', () => {
    expect(WIZARD_PRESENCE_LOCK_NAME).toBe('snowWizard:open');
  });
});
