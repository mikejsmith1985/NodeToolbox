// test/setup.ts — Vitest global test setup.
//
// Imported by every test file via vite.config.ts setupFiles.
// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// so test assertions read like plain English.

import '@testing-library/jest-dom';
