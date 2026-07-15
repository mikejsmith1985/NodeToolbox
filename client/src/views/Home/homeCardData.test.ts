// homeCardData.test.ts — Unit tests for the static Home view card catalog.

import { describe, expect, it } from 'vitest';

import { APP_CARDS, APP_SECTIONS, RECENT_VIEW_LABELS } from './homeCardData.ts';

describe('homeCardData', () => {
  it('contains the retained home cards including Reports Hub', () => {
    expect(APP_CARDS).toHaveLength(14);
    expect(APP_CARDS.some((appCard) => appCard.id === 'reports-hub')).toBe(true);
    expect(APP_CARDS.some((appCard) => appCard.id === 'business-helper')).toBe(true);
    expect(APP_CARDS.some((appCard) => appCard.id === 'jira-template-maker')).toBe(true);
    expect(APP_CARDS.some((appCard) => appCard.id === 'jira-intake')).toBe(true);
    expect(APP_CARDS.some((appCard) => appCard.id === 'feature-canvas')).toBe(true);
    expect(APP_CARDS.some((appCard) => appCard.id === 'po-tool')).toBe(true);
  });

  it('labels the PO Tool in the recent-links strip so it never shows a raw id', () => {
    expect(RECENT_VIEW_LABELS['po-tool']).toBeTruthy();
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

  it('removes the legacy reports section after card consolidation', () => {
    expect(APP_SECTIONS.map((sectionDef) => sectionDef.key)).not.toContain('reports');
  });
});
