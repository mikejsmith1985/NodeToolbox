// confluenceVersionConflict.test.ts — Recognising "someone else saved this page first" from Confluence.

import { describe, expect, it } from 'vitest';

import { ConfluenceRequestError } from './confluenceApi.ts';
import { isConfluenceVersionConflict } from './confluenceVersionConflict.ts';

describe('isConfluenceVersionConflict', () => {
  it('recognises Confluence\'s own "version must be incremented" refusal', () => {
    expect(isConfluenceVersionConflict(new Error('Confluence PUT page 1 failed: Version must be incremented on update.'))).toBe(true);
  });

  it('recognises a 409 conflict from the proxy', () => {
    expect(isConfluenceVersionConflict(new ConfluenceRequestError('Confluence PUT page 1 failed: Conflict', 409))).toBe(true);
  });

  it('does not treat other failures as conflicts', () => {
    expect(isConfluenceVersionConflict(new ConfluenceRequestError('Forbidden', 403))).toBe(false);
    expect(isConfluenceVersionConflict(new Error('Network down'))).toBe(false);
    expect(isConfluenceVersionConflict('Version must be incremented')).toBe(false);
  });
});
