// homeCardData.test.ts — Unit tests for the static Home view card catalog.

import { describe, expect, it } from 'vitest';

import { APP_CARDS, APP_SECTIONS, PERSONA_CARD_ORDERS } from './homeCardData.ts';

const EXPECTED_PERSONA_KEYS = ['all', 'dev', 'po', 'qa', 'rte', 'sm'];

describe('homeCardData', () => {
  it('contains all fourteen home cards', () => {
    expect(APP_CARDS).toHaveLength(14);
  });

  it('defines every required field for each card', () => {
    APP_CARDS.forEach((appCard) => {
      expect(appCard.id).toBeTruthy();
      expect(appCard.route).toBeTruthy();
      expect(appCard.icon).toBeTruthy();
      expect(appCard.title).toBeTruthy();
      expect(appCard.description).toBeTruthy();
      expect(Array.isArray(appCard.tags)).toBe(true);
      expect(appCard.tags.length).toBeGreaterThan(0);
      expect(appCard.sectionKey).toBeTruthy();
    });
  });

  it('uses only valid section keys for cards', () => {
    const validSectionKeys = new Set(APP_SECTIONS.map((sectionDef) => sectionDef.key));

    APP_CARDS.forEach((appCard) => {
      expect(validSectionKeys.has(appCard.sectionKey)).toBe(true);
    });
  });

  it('defines all supported personas', () => {
    expect(Object.keys(PERSONA_CARD_ORDERS).sort()).toEqual(EXPECTED_PERSONA_KEYS);
  });

  it('references only valid card identifiers in persona orders', () => {
    const validCardIds = new Set(APP_CARDS.map((appCard) => appCard.id));

    Object.values(PERSONA_CARD_ORDERS).forEach((personaCardOrder) => {
      personaCardOrder.forEach((cardId) => {
        expect(validCardIds.has(cardId)).toBe(true);
      });
    });
  });
});
