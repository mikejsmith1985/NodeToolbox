// intakeResolveDescriptions.test.ts — Each new Epic's description is found by its label or a heading naming the item,
// the answer table and the closing offer are kept out, and an item with no description gets none (GH #499).

import { describe, expect, it } from 'vitest';

import { buildDescriptionMarker, readItemDescriptions } from './intakeResolveDescriptions.ts';

const ITEM_IDS = ['item-1', 'item-2', 'item-10'];

describe('buildDescriptionMarker', () => {
  it('labels a description with its item id', () => {
    expect(buildDescriptionMarker('item-3')).toBe('item-3 DESCRIPTION');
  });
});

describe('readItemDescriptions', () => {
  it('reads labelled descriptions, keeping their nine-section headings inside', () => {
    const replyText = ['item-1 DESCRIPTION:', 'Description:', 'One.', 'Risks:', 'None.', 'item-2 DESCRIPTION: Description:', 'Two.'].join('\n');
    expect(readItemDescriptions(replyText, ITEM_IDS)).toEqual({ 'item-1': 'Description:\nOne.\nRisks:\nNone.', 'item-2': 'Description:\nTwo.' });
  });

  it('reads headings an answer engine writes, without confusing item-1 with item-10', () => {
    const replyText = ['Intro sentence.', '### item-10 — Description', 'Ten.', '**Description for item-1**', 'One.'].join('\n');
    expect(readItemDescriptions(replyText, ITEM_IDS)).toEqual({ 'item-10': 'Ten.', 'item-1': 'One.' });
  });

  it('keeps the answer table and the closing offer out of the last description', () => {
    const replyText = [
      'item-2 DESCRIPTION:',
      'Two.',
      '| Item | Verdict |',
      '| item-1 | existing |',
      'item-1\tcreateNew',
      'If you would like, I can draft Stories too.',
    ].join('\n');
    expect(readItemDescriptions(replyText, ITEM_IDS)).toEqual({ 'item-2': 'Two.' });
  });

  it('removes bold marks left by a bolded label', () => {
    expect(readItemDescriptions('**item-1 DESCRIPTION:**\nOne.', ITEM_IDS)).toEqual({ 'item-1': 'One.' });
  });

  it('returns nothing for an item whose description was not written', () => {
    expect(readItemDescriptions('No descriptions here.', ITEM_IDS)).toEqual({});
  });
});
