// wizardTransports.ts — The one place the Wizard keeps its live ServiceNow and Jira connections, read by the stand-ins
// that let Toolbox's own snowApi and jiraApi run unchanged inside the Wizard.

import type { RelayRequest, RelayResult } from '../../types/relay.ts';
import type { AgentRequest, AgentResponse } from './agentChannel.ts';

/** Runs a ServiceNow request the way Toolbox's relay bookmarklet would, answering with the same result shape. */
export interface SnowTransport {
  execute(relayRequest: RelayRequest): Promise<RelayResult>;
}

/** A Jira request as it crosses to the Jira tab; the body is the exact text Jira should receive. */
export type JiraTransportRequest = Omit<AgentRequest, 'body'> & { body?: string };

/** Runs a Jira request in the Jira tab the Wizard opened. Status 0 means Jira was never reached. */
export interface JiraTransport {
  execute(jiraRequest: JiraTransportRequest): Promise<AgentResponse>;
}

interface InstalledTransports {
  snow: SnowTransport | null;
  jira: JiraTransport | null;
}

const installedTransports: InstalledTransports = { snow: null, jira: null };

/** Installs one or both connections; a system not passed keeps whatever it already had. */
export function installWizardTransports(transports: Partial<InstalledTransports>): void {
  if (transports.snow !== undefined) installedTransports.snow = transports.snow;
  if (transports.jira !== undefined) installedTransports.jira = transports.jira;
}

/** The live ServiceNow connection, or null before the Wizard has connected. */
export function readSnowTransport(): SnowTransport | null {
  return installedTransports.snow;
}

/** The live Jira connection, or null before Jira has been opened from the Wizard. */
export function readJiraTransport(): JiraTransport | null {
  return installedTransports.jira;
}

/** Forgets both connections (tests, and a full reconnect). */
export function resetWizardTransports(): void {
  installedTransports.snow = null;
  installedTransports.jira = null;
}
