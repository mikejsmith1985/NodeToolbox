// githubEmailEngine.entry.ts — esbuild entry barrel bundled into a CommonJS module the Node server
// `require`s (src/services/generated/githubEmailEngine.cjs). It re-exports ONLY pure, browser-free
// functions and constants — no document/window/localStorage — so the deterministic email parser runs
// identically in the client unit tests and in the server's scheduled intake engine. Mirrors the
// piReviewEngine.entry.ts / monthlyDeliveryEngine.entry.ts pattern.

export { parseMime, getHeader, type MimeMessage } from '../views/GithubEmail/lib/parseMime.ts';
export {
  classifyGithubEmail,
  parseGithubEmail,
  type GitHubEmailEvent,
} from '../views/GithubEmail/lib/classifyGithubEmail.ts';
export {
  GITHUB_EMAIL_RULES,
  type EmailClassificationRule,
  type GithubEmailEventType,
} from '../views/GithubEmail/lib/githubEmailRules.ts';
export {
  isProcessed,
  findProcessed,
  appendProcessed,
  type EmailLedgerEntry,
} from '../views/GithubEmail/lib/emailLedger.ts';
