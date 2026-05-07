// PitchDeckView.tsx — React presentation view for the legacy ToolBox Pitch Deck.
//
// This component keeps the port intentionally direct: one full-bleed slide is
// visible at a time, the user can move through the deck with buttons, thumbnails,
// or keyboard shortcuts, and hardcoded HTML is rendered only from trusted source
// content carried in `pitchDeckSlides`.

import { type ReactNode } from 'react';

import { usePitchDeckState } from './hooks/usePitchDeckState.ts';
import { pitchDeckSlides, type PitchDeckSlide } from './pitchDeckSlides.ts';
import styles from './PitchDeckView.module.css';

const VIEW_TITLE = 'Pitch Deck';
const HERO_TITLE = '🎯 Toolbox';
const HERO_SUBTITLE = 'Executive Presentation — The Business Case for a Unified Agile Toolset';
const PREVIOUS_BUTTON_LABEL = '← Previous';
const NEXT_BUTTON_LABEL = 'Next →';
const THUMBNAIL_ARIA_PREFIX = 'Go to slide';

function renderSlideBody(pitchDeckSlide: PitchDeckSlide): ReactNode {
  return (
    <>
      <div
        className={styles.slideBody}
        dangerouslySetInnerHTML={{ __html: pitchDeckSlide.bodyHtml }}
      />
      {pitchDeckSlide.bullets && pitchDeckSlide.bullets.length > 0 && (
        <ul className={styles.slideBullets}>
          {pitchDeckSlide.bullets.map((bulletText) => (
            <li key={bulletText}>{bulletText}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Renders the Pitch Deck with persisted slide navigation and keyboard controls. */
export default function PitchDeckView() {
  const pitchDeckState = usePitchDeckState(pitchDeckSlides.length);
  const activeSlide = pitchDeckSlides[pitchDeckState.currentSlideIndex] ?? pitchDeckSlides[0];

  return (
    <section
      className={styles.pitchDeckView}
      aria-label={VIEW_TITLE}
      tabIndex={0}
      onKeyDown={pitchDeckState.handlePitchDeckKeyDown}
    >
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>{VIEW_TITLE}</p>
          <h1 className={styles.pageTitle}>{HERO_TITLE}</h1>
          <p className={styles.pageSubtitle}>{HERO_SUBTITLE}</p>
        </div>
        <div className={styles.slideIndicator} aria-label="Current slide">
          {pitchDeckState.currentSlideNumber} / {pitchDeckState.slideCount}
        </div>
      </header>

      <div className={styles.deckShell}>
        <button
          type="button"
          className={styles.navButton}
          disabled={!pitchDeckState.canGoToPreviousSlide}
          onClick={pitchDeckState.goToPreviousSlide}
        >
          {PREVIOUS_BUTTON_LABEL}
        </button>

        <article className={styles.slideCanvas} aria-labelledby={activeSlide.id}>
          <p className={styles.slideEyebrow}>Slide {pitchDeckState.currentSlideNumber}</p>
          <h2 id={activeSlide.id} className={styles.slideTitle}>
            {activeSlide.title}
          </h2>
          {renderSlideBody(activeSlide)}
        </article>

        <button
          type="button"
          className={styles.navButton}
          disabled={!pitchDeckState.canGoToNextSlide}
          onClick={pitchDeckState.goToNextSlide}
        >
          {NEXT_BUTTON_LABEL}
        </button>
      </div>

      <nav className={styles.thumbnailStrip} aria-label="Pitch Deck slide thumbnails">
        {pitchDeckSlides.map((pitchDeckSlide, slideIndex) => {
          const isActiveSlide = slideIndex === pitchDeckState.currentSlideIndex;
          return (
            <button
              key={pitchDeckSlide.id}
              type="button"
              className={isActiveSlide ? styles.thumbnailButtonActive : styles.thumbnailButton}
              aria-current={isActiveSlide ? 'step' : undefined}
              aria-label={`${THUMBNAIL_ARIA_PREFIX} ${slideIndex + 1}: ${pitchDeckSlide.title}`}
              onClick={() => pitchDeckState.goToSlideIndex(slideIndex)}
            >
              <span className={styles.thumbnailNumber}>{slideIndex + 1}</span>
              <span className={styles.thumbnailTitle}>{pitchDeckSlide.title}</span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}
