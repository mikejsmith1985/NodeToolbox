// colorFunctionFallback.ts — Rewrites modern CSS color functions into rgb() so html2canvas can render them.
//
// html2canvas 1.4.1 (the latest published release) cannot parse the modern CSS color
// functions that our theme relies on — most notably color-mix() — and Chromium serialises
// those values through getComputedStyle as color(srgb …) notation, which html2canvas also
// rejects with "Attempting to parse an unsupported color function 'color'". Before we hand a
// cloned section to html2canvas we walk it and replace any such value with the equivalent
// rgb()/rgba() string the browser itself computes, which html2canvas understands.

// The modern color-function names html2canvas cannot parse. "color-mix" is listed before
// "color" so the longer name is matched first when both share the same starting position.
const UNSUPPORTED_COLOR_FUNCTION_NAMES = ['color-mix', 'color', 'oklch', 'oklab', 'lab', 'lch', 'hwb'];

// CSS longhand properties whose value can carry a color function and therefore must be sanitised.
const EXPORT_COLOR_PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'box-shadow',
  'outline-color',
  'text-decoration-color',
  'column-rule-color',
  'fill',
  'stroke',
];

// A resolver turns a single color-function token (e.g. "color-mix(in srgb, …)") into a
// plain rgb()/rgba() string. It is injected so the parsing logic can be unit-tested
// without a real <canvas>.
export type ColorTokenResolver = (colorToken: string) => string;

/** Reports whether a CSS value contains a color function that html2canvas cannot parse. */
export function containsUnsupportedColorFunction(cssValue: string): boolean {
  return findColorFunction(cssValue, 0) !== null;
}

/**
 * Replaces every unsupported color function inside a CSS value with a resolved rgb() string,
 * leaving the rest of the value (gradients, lengths, rgb()/var() tokens) untouched.
 */
export function sanitizeColorValue(cssValue: string, resolveColorToken: ColorTokenResolver): string {
  if (!cssValue) {
    return cssValue;
  }

  let sanitizedValue = '';
  let scanCursor = 0;

  // Walk left to right, copying plain text and swapping each balanced color function for its rgb() form.
  for (;;) {
    const colorFunction = findColorFunction(cssValue, scanCursor);
    if (!colorFunction) {
      sanitizedValue += cssValue.slice(scanCursor);
      break;
    }

    sanitizedValue += cssValue.slice(scanCursor, colorFunction.startIndex);
    sanitizedValue += resolveColorToken(colorFunction.token);
    scanCursor = colorFunction.endIndex;
  }

  return sanitizedValue;
}

/**
 * Walks a cloned export subtree and rewrites any computed style that uses an unsupported color
 * function, so html2canvas only ever sees rgb()/rgba() values when it captures the element.
 */
export function applyExportColorFallbacks(
  rootElement: HTMLElement,
  resolveColorToken: ColorTokenResolver = createCanvasColorResolver(),
): void {
  const elementsToSanitize: Element[] = [rootElement, ...Array.from(rootElement.querySelectorAll('*'))];

  for (const element of elementsToSanitize) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
      continue;
    }

    const computedStyle = window.getComputedStyle(element);
    for (const propertyName of EXPORT_COLOR_PROPERTIES) {
      const computedValue = computedStyle.getPropertyValue(propertyName);
      if (!computedValue || !containsUnsupportedColorFunction(computedValue)) {
        continue;
      }

      // Pin the resolved colour inline so it overrides the stylesheet rule during capture.
      element.style.setProperty(propertyName, sanitizeColorValue(computedValue, resolveColorToken));
    }
  }
}

/**
 * Builds a resolver that paints a colour onto a 1×1 canvas and reads the pixel back, which forces
 * the browser to flatten any modern colour function into concrete rgba() channel values.
 */
export function createCanvasColorResolver(): ColorTokenResolver {
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  const probeContext = probeCanvas.getContext('2d');
  const resolvedTokenCache = new Map<string, string>();

  return function resolveColorToken(colorToken: string): string {
    const cachedValue = resolvedTokenCache.get(colorToken);
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    // Without a 2D context we cannot flatten the colour; return it unchanged as a last resort.
    if (!probeContext) {
      return colorToken;
    }

    // A black fallback ensures an unparseable token degrades to an opaque colour rather than throwing.
    probeContext.fillStyle = '#000000';
    probeContext.fillStyle = colorToken;
    probeContext.clearRect(0, 0, 1, 1);
    probeContext.fillRect(0, 0, 1, 1);

    const [red, green, blue, alpha] = probeContext.getImageData(0, 0, 1, 1).data;
    const normalizedAlpha = Number((alpha / 255).toFixed(3));
    const resolvedValue = `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;

    resolvedTokenCache.set(colorToken, resolvedValue);
    return resolvedValue;
  };
}

// ── Internal parsing helpers ───────────────────────────────────────────────

interface LocatedColorFunction {
  startIndex: number;
  endIndex: number;
  token: string;
}

/** Finds the next unsupported color function at or after fromIndex, including its balanced parentheses. */
function findColorFunction(cssValue: string, fromIndex: number): LocatedColorFunction | null {
  for (let charIndex = fromIndex; charIndex < cssValue.length; charIndex++) {
    for (const functionName of UNSUPPORTED_COLOR_FUNCTION_NAMES) {
      if (!matchesFunctionNameAt(cssValue, charIndex, functionName)) {
        continue;
      }

      const openParenIndex = charIndex + functionName.length;
      if (cssValue[openParenIndex] !== '(') {
        continue;
      }

      const closeParenIndex = findBalancedCloseParen(cssValue, openParenIndex);
      if (closeParenIndex === -1) {
        continue;
      }

      return {
        startIndex: charIndex,
        endIndex: closeParenIndex + 1,
        token: cssValue.slice(charIndex, closeParenIndex + 1),
      };
    }
  }

  return null;
}

/** True when functionName starts at charIndex and is not part of a longer identifier (e.g. the "lab" in "oklab"). */
function matchesFunctionNameAt(cssValue: string, charIndex: number, functionName: string): boolean {
  if (!cssValue.startsWith(functionName, charIndex)) {
    return false;
  }

  const precedingChar = charIndex === 0 ? '' : cssValue[charIndex - 1];
  return precedingChar === '' || !/[a-zA-Z0-9-]/.test(precedingChar);
}

/** Returns the index of the parenthesis that closes the one at openParenIndex, or -1 if unbalanced. */
function findBalancedCloseParen(cssValue: string, openParenIndex: number): number {
  let openParenDepth = 0;

  for (let charIndex = openParenIndex; charIndex < cssValue.length; charIndex++) {
    const currentChar = cssValue[charIndex];
    if (currentChar === '(') {
      openParenDepth++;
    } else if (currentChar === ')') {
      openParenDepth--;
      if (openParenDepth === 0) {
        return charIndex;
      }
    }
  }

  return -1;
}
