// assistantReplyText.test.ts — Recovering a pasted assistant reply whose line breaks were lost in copying.

import { describe, expect, it } from 'vitest';

import {
  CHG_FIELD_REPLY_SECTIONS,
  CODE_BLOCK_REPLY_INSTRUCTION,
  isAssistantQuestion,
  restoreMarkerLineBreaks,
  stripCodeFences,
} from './assistantReplyText.ts';

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

describe('isAssistantQuestion with Google AI Mode (GH #499)', () => {
  it('treats a heading-shaped answer that ends by offering more help as a reply, not a question', () => {
    const reply = 'Here are the fixes.\n\nBackout Plan\n1. Stop the job.\n\nWould you like me to tighten the test plan too?';

    expect(isAssistantQuestion(reply)).toBe(false);
  });

  it('still recognises the assistant\'s question', () => {
    expect(isAssistantQuestion('Who validates the change in production?')).toBe(true);
  });
});

describe('CHG_FIELD_REPLY_SECTIONS', () => {
  it('reads a rewrite round\'s qualified justification heading', () => {
    const justification = CHG_FIELD_REPLY_SECTIONS.find((section) => section.key === 'justification');

    ['Justification', 'Rewritten Justification', 'Revised RCP Justification', 'Business Justification']
      .forEach((headingText) => expect(justification?.headingPattern.test(headingText)).toBe(true));
    expect(justification?.headingPattern.test('Justification for the delay is weak')).toBe(false);
  });
});
