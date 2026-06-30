// determinism.test.ts — Guards the Today dashboard's two hard, non-negotiable constraints:
//   • FR-002 / SC-004: it has NO AI-Assist dependency, so it works fully with AI locked.
//   • FR-017: it performs NO Jira mutation from its own surface — it reads and counts only;
//     the only write it makes is daily checklist completion (a separate, non-Jira endpoint).
// These are structural invariants of the whole feature folder, so we assert them by scanning
// every Today source file rather than exercising one component path that could miss a regression.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Vitest runs with the client package root as the working directory, so resolve the feature
// folder from there. (import.meta.url is not a file: URL under this Vite test setup.)
const TODAY_DIR = join(process.cwd(), 'src', 'views', 'MyIssues', 'Today');

/** Recursively collects the feature's TypeScript source files, excluding test files. */
function collectSourceFiles(directoryPath: string): string[] {
  const collectedFiles: string[] = [];
  for (const dirEntry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, dirEntry.name);
    if (dirEntry.isDirectory()) {
      collectedFiles.push(...collectSourceFiles(entryPath));
      continue;
    }
    const isTestFile = dirEntry.name.includes('.test.');
    const isTypeScriptSource = dirEntry.name.endsWith('.ts') || dirEntry.name.endsWith('.tsx');
    if (isTypeScriptSource && !isTestFile) {
      collectedFiles.push(entryPath);
    }
  }
  return collectedFiles;
}

const sourceFiles = collectSourceFiles(TODAY_DIR);

describe('Today dashboard determinism guards', () => {
  it('scans at least the core feature source files', () => {
    // A sanity check so the guards below can never silently pass on an empty file list.
    expect(sourceFiles.length).toBeGreaterThanOrEqual(5);
  });

  it('depends on no AI-Assist capability (FR-002 / SC-004)', () => {
    for (const filePath of sourceFiles) {
      const fileContents = readFileSync(filePath, 'utf8');
      expect(fileContents, `${filePath} must not reference AI Assist`).not.toMatch(/ai[-_]?assist/i);
    }
  });

  it('performs no Jira mutation from the dashboard (FR-017)', () => {
    for (const filePath of sourceFiles) {
      const fileContents = readFileSync(filePath, 'utf8');
      expect(fileContents, `${filePath} must not call jiraPost`).not.toMatch(/\bjiraPost\b/);
      expect(fileContents, `${filePath} must not call jiraPut`).not.toMatch(/\bjiraPut\b/);
    }
  });
});
