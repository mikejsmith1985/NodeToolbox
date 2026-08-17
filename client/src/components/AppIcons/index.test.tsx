// AppIcons index.test.tsx — Proves every icon in the shared set obeys the same contract, including
// the action icons the SNow Hub added.
//
// The board's own test already asserted this for the board's eleven. It is asserted again here for the
// whole set, because the set is now shared: an icon added for one surface that quietly breaks the
// contract would break it everywhere.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AddIcon,
  AiAssistIcon,
  CheckIcon,
  ClipboardIcon,
  EditIcon,
  LoadedIcon,
  PinIcon,
  StartOverIcon,
  WarningIcon,
} from './index.tsx';

/** Every icon the SNow Hub swap introduced, plus one board icon as the control. */
const ACTION_ICONS: Array<[string, () => React.JSX.Element]> = [
  ['CheckIcon', CheckIcon],
  ['LoadedIcon', LoadedIcon],
  ['AddIcon', AddIcon],
  ['EditIcon', EditIcon],
  ['PinIcon', PinIcon],
  ['ClipboardIcon', ClipboardIcon],
  ['StartOverIcon', StartOverIcon],
  ['AiAssistIcon', AiAssistIcon],
  ['WarningIcon', WarningIcon],
];

/** Renders one icon and hands back the svg it produced. */
function renderIcon(Icon: () => React.JSX.Element): SVGElement {
  const { container } = render(<Icon />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('icon rendered no svg');
  return svg;
}

describe('AppIcons', () => {
  it('takes its colour from the surrounding text, so every icon follows the theme', () => {
    // The property emoji could never have, and the reason these exist at all.
    for (const [name, Icon] of ACTION_ICONS) {
      expect(renderIcon(Icon).getAttribute('stroke'), name).toBe('currentColor');
    }
  });

  it('is sized in em, so every icon grows with the text setting', () => {
    for (const [name, Icon] of ACTION_ICONS) {
      const svg = renderIcon(Icon);
      expect(svg.getAttribute('width'), name).toBe('1em');
      expect(svg.getAttribute('height'), name).toBe('1em');
    }
  });

  it('is hidden from screen readers, because the word beside it carries the meaning', () => {
    // This is what makes swapping an emoji for an icon IMPROVE a button's accessible name rather than
    // shorten it arbitrarily: the glyph was being read aloud, and the icon is not.
    for (const [name, Icon] of ACTION_ICONS) {
      expect(renderIcon(Icon).getAttribute('aria-hidden'), name).toBe('true');
    }
  });

  it('draws every icon at one stroke weight, so they read as one set', () => {
    const strokeWidths = ACTION_ICONS.map(([, Icon]) => renderIcon(Icon).getAttribute('stroke-width'));

    expect(new Set(strokeWidths).size).toBe(1);
  });

  it('gives a resolved tick and a loaded record DIFFERENT shapes', () => {
    // They mean different things — one value confirmed, versus a whole record fetched — and a shared
    // vocabulary is only worth having while two meanings do not collapse into one picture.
    expect(renderIcon(CheckIcon).innerHTML).not.toBe(renderIcon(LoadedIcon).innerHTML);
  });
});
