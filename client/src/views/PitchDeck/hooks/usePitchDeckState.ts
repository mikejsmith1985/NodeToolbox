// usePitchDeckState.ts — React state hook for Pitch Deck slide navigation.
//
// The legacy Pitch Deck was driven by DOM functions. This hook keeps the same
// clamped previous/next style navigation while adding the requested persisted
// current slide index and keyboard shortcuts for the React port.

import { useCallback, useMemo, useState } from 'react';

import { pitchDeckSlides } from '../pitchDeckSlides.ts';

/** localStorage key required by the port so users resume where they left off. */
export const PITCH_DECK_STORAGE_KEY = 'tbxPitchDeckIndex';

const FIRST_SLIDE_INDEX = 0;
const SINGLE_STEP = 1;
const DECIMAL_RADIX = 10;

export interface PitchDeckState {
  currentSlideIndex: number;
  currentSlideNumber: number;
  slideCount: number;
  canGoToPreviousSlide: boolean;
  canGoToNextSlide: boolean;
  goToPreviousSlide: () => void;
  goToNextSlide: () => void;
  goToFirstSlide: () => void;
  goToLastSlide: () => void;
  goToSlideIndex: (requestedSlideIndex: number) => void;
  handlePitchDeckKeyDown: (keyboardEvent: Pick<KeyboardEvent, 'key' | 'preventDefault'>) => void;
}

/** Clamps an arbitrary index into the available slide range so navigation never crashes. */
export function clampSlideIndex(requestedSlideIndex: number, slideCount: number): number {
  if (slideCount <= FIRST_SLIDE_INDEX) {
    return FIRST_SLIDE_INDEX;
  }

  const lastSlideIndex = slideCount - SINGLE_STEP;
  return Math.min(Math.max(requestedSlideIndex, FIRST_SLIDE_INDEX), lastSlideIndex);
}

/** Reads the persisted slide index and falls back safely when storage is empty or invalid. */
export function readStoredSlideIndex(slideCount: number): number {
  if (typeof window === 'undefined') {
    return FIRST_SLIDE_INDEX;
  }

  try {
    const storedSlideIndex = window.localStorage.getItem(PITCH_DECK_STORAGE_KEY);
    if (storedSlideIndex === null) {
      return FIRST_SLIDE_INDEX;
    }

    const parsedSlideIndex = Number.parseInt(storedSlideIndex, DECIMAL_RADIX);
    if (Number.isNaN(parsedSlideIndex)) {
      return FIRST_SLIDE_INDEX;
    }

    return clampSlideIndex(parsedSlideIndex, slideCount);
  } catch {
    return FIRST_SLIDE_INDEX;
  }
}

/** Writes the latest slide index without letting browser storage failures break navigation. */
export function writeStoredSlideIndex(slideIndex: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(PITCH_DECK_STORAGE_KEY, String(slideIndex));
  } catch {
    // Storage can be disabled by browser policy; slide navigation should still work.
  }
}

/** Provides Pitch Deck navigation state, persistence, and keyboard shortcuts to the view. */
export function usePitchDeckState(slideCount = pitchDeckSlides.length): PitchDeckState {
  const safeSlideCount = Math.max(slideCount, FIRST_SLIDE_INDEX);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(() => readStoredSlideIndex(safeSlideCount));

  const commitSlideIndex = useCallback(
    (requestedSlideIndex: number) => {
      const nextSlideIndex = clampSlideIndex(requestedSlideIndex, safeSlideCount);
      setCurrentSlideIndex(nextSlideIndex);
      writeStoredSlideIndex(nextSlideIndex);
    },
    [safeSlideCount],
  );

  const goToPreviousSlide = useCallback(() => {
    commitSlideIndex(currentSlideIndex - SINGLE_STEP);
  }, [commitSlideIndex, currentSlideIndex]);

  const goToNextSlide = useCallback(() => {
    commitSlideIndex(currentSlideIndex + SINGLE_STEP);
  }, [commitSlideIndex, currentSlideIndex]);

  const goToFirstSlide = useCallback(() => {
    commitSlideIndex(FIRST_SLIDE_INDEX);
  }, [commitSlideIndex]);

  const goToLastSlide = useCallback(() => {
    commitSlideIndex(safeSlideCount - SINGLE_STEP);
  }, [commitSlideIndex, safeSlideCount]);

  const handlePitchDeckKeyDown = useCallback(
    (keyboardEvent: Pick<KeyboardEvent, 'key' | 'preventDefault'>) => {
      if (keyboardEvent.key === 'ArrowLeft') {
        keyboardEvent.preventDefault();
        goToPreviousSlide();
        return;
      }

      if (keyboardEvent.key === 'ArrowRight') {
        keyboardEvent.preventDefault();
        goToNextSlide();
        return;
      }

      if (keyboardEvent.key === 'Home') {
        keyboardEvent.preventDefault();
        goToFirstSlide();
        return;
      }

      if (keyboardEvent.key === 'End') {
        keyboardEvent.preventDefault();
        goToLastSlide();
      }
    },
    [goToFirstSlide, goToLastSlide, goToNextSlide, goToPreviousSlide],
  );

  return useMemo(
    () => ({
      currentSlideIndex,
      currentSlideNumber: currentSlideIndex + SINGLE_STEP,
      slideCount: safeSlideCount,
      canGoToPreviousSlide: currentSlideIndex > FIRST_SLIDE_INDEX,
      canGoToNextSlide: currentSlideIndex < safeSlideCount - SINGLE_STEP,
      goToPreviousSlide,
      goToNextSlide,
      goToFirstSlide,
      goToLastSlide,
      goToSlideIndex: commitSlideIndex,
      handlePitchDeckKeyDown,
    }),
    [
      commitSlideIndex,
      currentSlideIndex,
      goToFirstSlide,
      goToLastSlide,
      goToNextSlide,
      goToPreviousSlide,
      handlePitchDeckKeyDown,
      safeSlideCount,
    ],
  );
}
