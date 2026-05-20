// test/unit/demoMode.test.js — Unit tests for first-install demo request detection.

'use strict';

const {
  createDemoModePath,
  isDemoModeRequest,
} = require('../../src/utils/demoMode');

function buildRequest({ query = {}, headerValue = undefined } = {}) {
  return {
    query,
    get(headerName) {
      return headerName === 'x-nodetoolbox-demo-mode' ? headerValue : undefined;
    },
  };
}

describe('demoMode utilities', () => {
  it('detects demo mode from the launch query parameter', () => {
    expect(isDemoModeRequest(buildRequest({ query: { demo: '1' } }))).toBe(true);
  });

  it('detects demo mode from the client request header', () => {
    expect(isDemoModeRequest(buildRequest({ headerValue: '1' }))).toBe(true);
  });

  it('does not enable demo mode for regular requests', () => {
    expect(isDemoModeRequest(buildRequest())).toBe(false);
  });

  it('adds the demo query parameter to local paths', () => {
    expect(createDemoModePath('/setup')).toBe('/setup?demo=1');
    expect(createDemoModePath('/setup?step=welcome')).toBe('/setup?step=welcome&demo=1');
  });
});
