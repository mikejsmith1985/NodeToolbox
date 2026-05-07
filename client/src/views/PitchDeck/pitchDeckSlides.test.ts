// pitchDeckSlides.test.ts — Invariant tests for static Pitch Deck slide content.

import { describe, expect, it } from 'vitest';

import { pitchDeckSlides } from './pitchDeckSlides.ts';

const EXPECTED_LEGACY_SLIDE_COUNT = 6;
const EXPECTED_FIRST_SLIDE_ID = 'pd-slide-1';
const EXPECTED_LAST_SLIDE_ID = 'pd-slide-6';

describe('pitchDeckSlides', () => {
  it('ports the observable legacy slide count and order', () => {
    expect(pitchDeckSlides).toHaveLength(EXPECTED_LEGACY_SLIDE_COUNT);
    expect(pitchDeckSlides[0].id).toBe(EXPECTED_FIRST_SLIDE_ID);
    expect(pitchDeckSlides[pitchDeckSlides.length - 1].id).toBe(EXPECTED_LAST_SLIDE_ID);
  });

  it('gives every slide a title and visible body content', () => {
    pitchDeckSlides.forEach((pitchDeckSlide) => {
      expect(pitchDeckSlide.title.trim()).not.toBe('');
      expect(pitchDeckSlide.bodyHtml.trim()).not.toBe('');
    });
  });

  it('uses unique stable slide identifiers', () => {
    const uniqueSlideIds = new Set(pitchDeckSlides.map((pitchDeckSlide) => pitchDeckSlide.id));

    expect(uniqueSlideIds.size).toBe(pitchDeckSlides.length);
  });

  it('keeps optional bullet lists meaningful when present', () => {
    pitchDeckSlides.forEach((pitchDeckSlide) => {
      if (!pitchDeckSlide.bullets) {
        return;
      }

      pitchDeckSlide.bullets.forEach((bulletText) => {
        expect(bulletText.trim()).not.toBe('');
      });
    });
  });
});
