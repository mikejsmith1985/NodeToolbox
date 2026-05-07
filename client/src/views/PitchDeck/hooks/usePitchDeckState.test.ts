// usePitchDeckState.test.ts — Unit tests for Pitch Deck navigation state.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PITCH_DECK_STORAGE_KEY,
  clampSlideIndex,
  readStoredSlideIndex,
  usePitchDeckState,
} from './usePitchDeckState.ts';

const SAMPLE_SLIDE_COUNT = 6;
const SECOND_SLIDE_INDEX = 1;
const THIRD_SLIDE_INDEX = 2;
const LAST_SLIDE_INDEX = 5;
const OUT_OF_RANGE_SLIDE_INDEX = 99;

describe('Pitch Deck navigation helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clamps requested slide indexes into the available range', () => {
    expect(clampSlideIndex(-OUT_OF_RANGE_SLIDE_INDEX, SAMPLE_SLIDE_COUNT)).toBe(0);
    expect(clampSlideIndex(THIRD_SLIDE_INDEX, SAMPLE_SLIDE_COUNT)).toBe(THIRD_SLIDE_INDEX);
    expect(clampSlideIndex(OUT_OF_RANGE_SLIDE_INDEX, SAMPLE_SLIDE_COUNT)).toBe(LAST_SLIDE_INDEX);
  });

  it('reads a valid stored slide index and clamps stale values', () => {
    window.localStorage.setItem(PITCH_DECK_STORAGE_KEY, String(OUT_OF_RANGE_SLIDE_INDEX));

    expect(readStoredSlideIndex(SAMPLE_SLIDE_COUNT)).toBe(LAST_SLIDE_INDEX);
  });
});

describe('usePitchDeckState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts on the first slide with only next navigation enabled', () => {
    const { result } = renderHook(() => usePitchDeckState(SAMPLE_SLIDE_COUNT));

    expect(result.current.currentSlideIndex).toBe(0);
    expect(result.current.currentSlideNumber).toBe(1);
    expect(result.current.canGoToPreviousSlide).toBe(false);
    expect(result.current.canGoToNextSlide).toBe(true);
  });

  it('moves next and previous without wrapping around the deck', () => {
    const { result } = renderHook(() => usePitchDeckState(SAMPLE_SLIDE_COUNT));

    act(() => result.current.goToNextSlide());
    expect(result.current.currentSlideIndex).toBe(SECOND_SLIDE_INDEX);

    act(() => result.current.goToPreviousSlide());
    act(() => result.current.goToPreviousSlide());
    expect(result.current.currentSlideIndex).toBe(0);
  });

  it('goes directly to requested slides and persists the choice', () => {
    const { result } = renderHook(() => usePitchDeckState(SAMPLE_SLIDE_COUNT));

    act(() => result.current.goToSlideIndex(THIRD_SLIDE_INDEX));

    expect(result.current.currentSlideIndex).toBe(THIRD_SLIDE_INDEX);
    expect(window.localStorage.getItem(PITCH_DECK_STORAGE_KEY)).toBe(String(THIRD_SLIDE_INDEX));
  });

  it('supports ArrowLeft, ArrowRight, Home, and End keyboard commands', () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => usePitchDeckState(SAMPLE_SLIDE_COUNT));

    act(() => result.current.handlePitchDeckKeyDown({ key: 'ArrowRight', preventDefault }));
    expect(result.current.currentSlideIndex).toBe(SECOND_SLIDE_INDEX);

    act(() => result.current.handlePitchDeckKeyDown({ key: 'End', preventDefault }));
    expect(result.current.currentSlideIndex).toBe(LAST_SLIDE_INDEX);

    act(() => result.current.handlePitchDeckKeyDown({ key: 'ArrowLeft', preventDefault }));
    expect(result.current.currentSlideIndex).toBe(LAST_SLIDE_INDEX - 1);

    act(() => result.current.handlePitchDeckKeyDown({ key: 'Home', preventDefault }));
    expect(result.current.currentSlideIndex).toBe(0);
    expect(preventDefault).toHaveBeenCalledTimes(4);
  });
});
