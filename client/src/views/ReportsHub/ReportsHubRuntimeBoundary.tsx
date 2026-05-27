// ReportsHubRuntimeBoundary.tsx — Runtime guard that surfaces diagnostics instead of a blank Reports Hub view.

import { Component, type ErrorInfo, type ReactNode } from 'react';

import styles from './ReportsHubView.module.css';

const REPORTS_HUB_DIAGNOSTIC_STORAGE_KEYS = [
  'tbxARTSettings',
  'tbxReportsHubHelp',
  'tbxReportsLastGenerated',
] as const;

interface ReportsHubRuntimeBoundaryProps {
  children: ReactNode;
}

interface ReportsHubRuntimeErrorState {
  hasRuntimeError: boolean;
  errorMessage: string;
  errorStack: string;
  componentStack: string;
  capturedAtIso: string;
}

function readDiagnosticStorageSnapshot(): Record<string, string | null> {
  const storageSnapshot: Record<string, string | null> = {};
  for (const storageKey of REPORTS_HUB_DIAGNOSTIC_STORAGE_KEYS) {
    try {
      storageSnapshot[storageKey] = localStorage.getItem(storageKey);
    } catch {
      storageSnapshot[storageKey] = '<unavailable>';
    }
  }
  return storageSnapshot;
}

function buildDiagnosticPayload(runtimeErrorState: ReportsHubRuntimeErrorState): string {
  return JSON.stringify(
    {
      area: 'ReportsHub',
      capturedAt: runtimeErrorState.capturedAtIso,
      errorMessage: runtimeErrorState.errorMessage,
      errorStack: runtimeErrorState.errorStack,
      componentStack: runtimeErrorState.componentStack,
      url: typeof window !== 'undefined' ? window.location.href : '<unknown>',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '<unknown>',
      storageSnapshot: readDiagnosticStorageSnapshot(),
    },
    null,
    2,
  );
}

/**
 * Captures render-time runtime errors in Reports Hub and replaces blank-screen failure
 * with an on-page diagnostic panel that can be copied for triage.
 */
export class ReportsHubRuntimeBoundary extends Component<
  ReportsHubRuntimeBoundaryProps,
  ReportsHubRuntimeErrorState
> {
  public state: ReportsHubRuntimeErrorState = {
    hasRuntimeError: false,
    errorMessage: '',
    errorStack: '',
    componentStack: '',
    capturedAtIso: '',
  };

  static getDerivedStateFromError(caughtError: Error): Partial<ReportsHubRuntimeErrorState> {
    return {
      hasRuntimeError: true,
      errorMessage: caughtError.message,
      errorStack: caughtError.stack ?? '',
      capturedAtIso: new Date().toISOString(),
    };
  }

  componentDidCatch(caughtError: Error, errorInfo: ErrorInfo): void {
    this.setState({
      hasRuntimeError: true,
      errorMessage: caughtError.message,
      errorStack: caughtError.stack ?? '',
      componentStack: errorInfo.componentStack ?? '',
      capturedAtIso: new Date().toISOString(),
    });
  }

  private readonly handleCopyDiagnostics = async (): Promise<void> => {
    const diagnosticPayload = buildDiagnosticPayload(this.state);
    await navigator.clipboard.writeText(diagnosticPayload);
  };

  private readonly handleReloadReportsHub = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasRuntimeError) {
      return this.props.children;
    }

    const diagnosticPayload = buildDiagnosticPayload(this.state);
    return (
      <section className={styles.runtimeDiagnosticsPanel} role="alert">
        <h2 className={styles.runtimeDiagnosticsTitle}>Reports Hub encountered a runtime error</h2>
        <p className={styles.runtimeDiagnosticsBody}>
          The report view was prevented from going blank. Copy the diagnostics below and share them so we can fix the root cause quickly.
        </p>
        <div className={styles.runtimeDiagnosticsActions}>
          <button className={styles.actionButton} onClick={() => void this.handleCopyDiagnostics()} type="button">
            Copy diagnostics
          </button>
          <button className={`${styles.actionButton} ${styles.primaryButton}`} onClick={this.handleReloadReportsHub} type="button">
            Reload Reports Hub
          </button>
        </div>
        <pre className={styles.runtimeDiagnosticsPre}>{diagnosticPayload}</pre>
      </section>
    );
  }
}
