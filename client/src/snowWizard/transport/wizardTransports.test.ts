// wizardTransports.test.ts — Proves the one place the Wizard keeps its live ServiceNow and Jira connections.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWizardTransports, readJiraTransport, readSnowTransport, resetWizardTransports } from './wizardTransports.ts';

afterEach(() => {
  resetWizardTransports();
});

describe('wizardTransports', () => {
  it('starts empty', () => {
    expect(readSnowTransport()).toBeNull();
    expect(readJiraTransport()).toBeNull();
  });

  it('installs each system independently, so connecting Jira later keeps ServiceNow', () => {
    const snowTransport = { execute: vi.fn() };
    const jiraTransport = { execute: vi.fn() };
    installWizardTransports({ snow: snowTransport });
    installWizardTransports({ jira: jiraTransport });
    expect(readSnowTransport()).toBe(snowTransport);
    expect(readJiraTransport()).toBe(jiraTransport);
  });
});
