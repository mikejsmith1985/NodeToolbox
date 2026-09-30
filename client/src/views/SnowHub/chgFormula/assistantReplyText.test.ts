// assistantReplyText.test.ts — Recovering a pasted assistant reply whose line breaks were lost in copying.

import { describe, expect, it } from 'vitest';

import { CODE_BLOCK_REPLY_INSTRUCTION, restoreMarkerLineBreaks, stripCodeFences } from './assistantReplyText.ts';

describe('stripCodeFences', () => {
  it('removes the ``` fence lines a code-block reply is wrapped in, keeping everything inside', () => {
    expect(stripCodeFences('```text\nSHORT_DESCRIPTION: Deploy\nBACKOUT_PLAN: Redeploy\n```')).toBe(
      'SHORT_DESCRIPTION: Deploy\nBACKOUT_PLAN: Redeploy',
    );
  });

  it('leaves a reply with no fences alone', () => {
    expect(stripCodeFences('PASS | Risk — Rated.')).toBe('PASS | Risk — Rated.');
  });
});

describe('restoreMarkerLineBreaks', () => {
  it('puts each marker back at the start of its own line when copying flattened the reply', () => {
    const flattened = 'SHORT_DESCRIPTION: Deploy 26.10 DESCRIPTION: Current state is broken. BACKOUT_PLAN: Redeploy 26.9.';

    expect(restoreMarkerLineBreaks(flattened, ['SHORT_DESCRIPTION', 'DESCRIPTION', 'BACKOUT_PLAN'])).toBe(
      'SHORT_DESCRIPTION: Deploy 26.10\nDESCRIPTION: Current state is broken.\nBACKOUT_PLAN: Redeploy 26.9.',
    );
  });

  it('does not split a marker that is part of a longer one', () => {
    expect(restoreMarkerLineBreaks('SHORT_DESCRIPTION: Deploy', ['SHORT_DESCRIPTION', 'DESCRIPTION'])).toBe(
      'SHORT_DESCRIPTION: Deploy',
    );
  });

  it('only matches the upper-case marker, so ordinary words in the text are untouched', () => {
    expect(restoreMarkerLineBreaks('The description: is clear', ['DESCRIPTION'])).toBe('The description: is clear');
  });

  it('handles markers that end in a pipe as well as a colon', () => {
    expect(restoreMarkerLineBreaks('PASS | Risk — ok. GAP | Blast Radius — missing.', ['PASS', 'GAP'])).toBe(
      'PASS | Risk — ok.\nGAP | Blast Radius — missing.',
    );
  });
});

describe('CODE_BLOCK_REPLY_INSTRUCTION', () => {
  it('asks for the whole reply in one code block, so its line breaks survive copying', () => {
    expect(CODE_BLOCK_REPLY_INSTRUCTION).toContain('```text');
  });
});
