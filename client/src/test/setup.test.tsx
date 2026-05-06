// test/setup.test.tsx — Verifies that the Vitest global test setup loads correctly.
//
// setup.ts registers @testing-library/jest-dom matchers globally. This test
// confirms those matchers are available, so any future test failures using
// toBeInTheDocument() are diagnosed as a setup problem rather than a matcher problem.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

describe('test environment setup', () => {
  it('jest-dom matchers are registered after setup.ts loads', () => {
    // Render a minimal element and assert using a jest-dom matcher.
    // If setup.ts failed to run, toBeInTheDocument would throw "not a function".
    const { container } = render(<div data-testid="probe">alive</div>);
    const probeElement = container.firstChild as HTMLElement;
    expect(probeElement).toBeInTheDocument();
  });

  it('the DOM environment is jsdom (not node)', () => {
    // Confirms Vite test environment is set to jsdom so window, document,
    // and other browser globals are available in all test files.
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });
});
