// BoardIcons.test.tsx — Proves the board's icons obey the theme and the type scale, which is the
// whole reason they replaced emoji.
//
// An emoji could do neither: it is a colour glyph drawn by the operating system, so it ignored the
// app's palette entirely and was sized by the vendor rather than by us. These assertions are the two
// properties that difference rests on, so a future change that reintroduces a fixed colour or a fixed
// pixel size fails here rather than being noticed on somebody's screen.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BlockedIcon, FlagIcon, InfoIcon, WarningIcon } from './BoardIcons.tsx';

/** Renders one icon and hands back the svg it produced. */
function renderIcon(Icon: () => React.JSX.Element): SVGElement {
  const { container } = render(<Icon />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('icon rendered no svg');
  return svg;
}

describe('BoardIcons', () => {
  it('takes its colour from the surrounding text, so it follows the theme', () => {
    // The property emoji could never have: a colour glyph stays its own colour in both themes, which
    // is exactly where the board's two-theme palette used to stop.
    expect(renderIcon(FlagIcon).getAttribute('stroke')).toBe('currentColor');
  });

  it('is sized in em, so it grows with the app\'s text setting', () => {
    // A pixel size would shrink relative to everything around it at the larger text settings.
    const svg = renderIcon(WarningIcon);

    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
  });

  it('is hidden from screen readers, because the word beside it carries the meaning', () => {
    // The board's rule is that colour is never the only signal; the same logic makes the icon
    // decoration and the text the thing that is read.
    expect(renderIcon(BlockedIcon).getAttribute('aria-hidden')).toBe('true');
  });

  it('draws every icon at one stroke weight, so they read as one set', () => {
    const strokeWidths = [FlagIcon, BlockedIcon, WarningIcon, InfoIcon]
      .map((Icon) => renderIcon(Icon).getAttribute('stroke-width'));

    expect(new Set(strokeWidths).size).toBe(1);
  });
});
