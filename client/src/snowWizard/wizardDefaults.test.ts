// wizardDefaults.test.ts — Proves the Wizard's built-in addresses are the agreed ones and match Toolbox's own default.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_JIRA_URL, DEFAULT_SNOW_URL, JIRA_IDENTITY_PATH, SNOW_IDENTITY_PATH, WIZARD_CHANNEL_NAME } from './wizardDefaults.ts';

describe('wizardDefaults', () => {
  it('uses the ServiceNow address the owner gave (GH #449)', () => {
    expect(DEFAULT_SNOW_URL).toBe('https://zilverton.service-now.com');
  });

  it('pre-fills Jira with the same default Toolbox ships, so the two never disagree', () => {
    const toolboxConfigLoader = readFileSync(resolve(__dirname, '../../../src/config/loader.js'), 'utf8');
    expect(toolboxConfigLoader).toContain(`baseUrl:  '${DEFAULT_JIRA_URL}'`);
  });

  it('talks on the Wizard\'s own channel', () => {
    expect(WIZARD_CHANNEL_NAME).toBe('snowWizard');
  });

  it('asks each system who is signed in with a same-site read the relay bookmark will serve', () => {
    for (const identityPath of [SNOW_IDENTITY_PATH, JIRA_IDENTITY_PATH]) {
      expect(identityPath.startsWith('/')).toBe(true);
      expect(identityPath.startsWith('//')).toBe(false);
    }
    expect(SNOW_IDENTITY_PATH).toContain('/api/now/table/sys_user');
    expect(SNOW_IDENTITY_PATH).toContain('sysparm_limit=1');
    expect(JIRA_IDENTITY_PATH).toBe('/rest/api/2/myself');
  });
});
