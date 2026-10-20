// readOnlyTransport.ts — Makes the Review job unable to change ServiceNow: while a review is open, the Wizard's
// ServiceNow connection is wrapped so that anything other than a read is refused before it leaves the Wizard.
//
// Custom (Art VII): Toolbox's snowApi has no read-only mode; the Wizard's installed transport is the one seam every
// ServiceNow request already passes through, so the guard sits there without touching any reader.

import type { RelayRequest, RelayResult } from '../../types/relay.ts';
import { installWizardTransports, readSnowTransport, type SnowTransport } from '../transport/wizardTransports.ts';

const READ_METHOD = 'GET';

/** Thrown when anything tries to change ServiceNow during a review. */
export class ReviewIsReadOnlyError extends Error {
  constructor(method: string, path: string) {
    super(`Review is read-only — a ${method} to ${path} was stopped before it reached ServiceNow.`);
    this.name = 'ReviewIsReadOnlyError';
  }
}

/** A ServiceNow connection that only reads, remembering the connection it guards. */
export interface ReadOnlySnowTransport extends SnowTransport {
  readonly guardedTransport: SnowTransport;
}

/** Wraps a connection so reads pass through and every other request is refused. */
export function createReadOnlySnowTransport(guardedTransport: SnowTransport): ReadOnlySnowTransport {
  return {
    guardedTransport,
    async execute(relayRequest: RelayRequest): Promise<RelayResult> {
      const method = (relayRequest.method || '').toUpperCase();
      if (method !== READ_METHOD) throw new ReviewIsReadOnlyError(method, relayRequest.path);
      return guardedTransport.execute(relayRequest);
    },
  };
}

/** Whether a connection is already the read-only guard. */
export function isReadOnlySnowTransport(snowTransport: SnowTransport | null): snowTransport is ReadOnlySnowTransport {
  return snowTransport !== null && 'guardedTransport' in snowTransport;
}

/**
 * Guards the installed ServiceNow connection for as long as the review runs, and returns the function that puts the
 * guarded connection back. Safe to call again (it never wraps twice) and before connecting (it guards nothing).
 */
export function installReadOnlySnowTransport(): () => void {
  const currentTransport = readSnowTransport();
  if (currentTransport !== null && !isReadOnlySnowTransport(currentTransport)) {
    installWizardTransports({ snow: createReadOnlySnowTransport(currentTransport) });
  }
  return () => {
    const installedTransport = readSnowTransport();
    if (isReadOnlySnowTransport(installedTransport)) installWizardTransports({ snow: installedTransport.guardedTransport });
  };
}
