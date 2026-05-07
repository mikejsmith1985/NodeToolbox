// PitchDeckView.test.tsx — Component tests for the Pitch Deck React view.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import PitchDeckView from './PitchDeckView.tsx';
import { PITCH_DECK_STORAGE_KEY } from './hooks/usePitchDeckState.ts';
import { pitchDeckSlides } from './pitchDeckSlides.ts';

const SECOND_SLIDE_TITLE = '✅ Slide 2 — The Solution';
const LAST_SLIDE_TITLE = '📊 Slide 6 — The Executive Command Center';

describe('PitchDeckView', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the first slide with the legacy deck heading and indicator', () => {
    render(<PitchDeckView />);

    expect(screen.getByRole('heading', { name: '🎯 Toolbox' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pitchDeckSlides[0].title })).toBeInTheDocument();
    expect(screen.getByLabelText('Current slide')).toHaveTextContent(`1 / ${pitchDeckSlides.length}`);
    expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled();
  });

  it('advances and retreats with the navigation buttons', () => {
    render(<PitchDeckView />);

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('heading', { name: SECOND_SLIDE_TITLE })).toBeInTheDocument();
    expect(screen.getByLabelText('Current slide')).toHaveTextContent(`2 / ${pitchDeckSlides.length}`);

    fireEvent.click(screen.getByRole('button', { name: '← Previous' }));
    expect(screen.getByRole('heading', { name: pitchDeckSlides[0].title })).toBeInTheDocument();
  });

  it('supports ArrowRight, ArrowLeft, Home, and End keyboard navigation', () => {
    render(<PitchDeckView />);
    const pitchDeckRegion = screen.getByLabelText('Pitch Deck');

    fireEvent.keyDown(pitchDeckRegion, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: SECOND_SLIDE_TITLE })).toBeInTheDocument();

    fireEvent.keyDown(pitchDeckRegion, { key: 'End' });
    expect(screen.getByRole('heading', { name: LAST_SLIDE_TITLE })).toBeInTheDocument();

    fireEvent.keyDown(pitchDeckRegion, { key: 'ArrowLeft' });
    expect(screen.getByLabelText('Current slide')).toHaveTextContent(`${pitchDeckSlides.length - 1} / ${pitchDeckSlides.length}`);

    fireEvent.keyDown(pitchDeckRegion, { key: 'Home' });
    expect(screen.getByRole('heading', { name: pitchDeckSlides[0].title })).toBeInTheDocument();
  });

  it('jumps to slides through thumbnails and stores the selected index', () => {
    render(<PitchDeckView />);

    fireEvent.click(screen.getByRole('button', { name: `Go to slide 6: ${LAST_SLIDE_TITLE}` }));

    expect(screen.getByRole('heading', { name: LAST_SLIDE_TITLE })).toBeInTheDocument();
    expect(window.localStorage.getItem(PITCH_DECK_STORAGE_KEY)).toBe(String(pitchDeckSlides.length - 1));
  });

  it('restores the persisted slide index on first render', () => {
    window.localStorage.setItem(PITCH_DECK_STORAGE_KEY, String(pitchDeckSlides.length - 1));

    render(<PitchDeckView />);

    expect(screen.getByRole('heading', { name: LAST_SLIDE_TITLE })).toBeInTheDocument();
  });
});
