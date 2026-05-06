// textTransformUtils.ts — Pure string transformation utilities for the Text Tools view.
//
// All functions are deterministic and side-effect-free. They can be tested without mocking.

// ── Type definitions ──

/** Supported output modes for the Smart Formatter. */
export type SmartFormatterMode = 'markdown' | 'plain' | 'structured'

/** Supported indent sizes for JSON formatting. 0 = minify. */
export type JsonIndentMode = 2 | 4 | 0

/** Direction of a URL encode/decode operation. */
export type UrlOperation = 'encode' | 'decode'

/** Scope of URI encoding — component or full URI. */
export type UrlScope = 'component' | 'full'

/** Direction of a Base64 encode/decode operation. */
export type Base64Operation = 'encode' | 'decode'

/** A single labelled case variant of an input string. */
export interface CaseVariant {
  label: string
  value: string
}

// ── Named constants ──

const CASE_VARIANT_LABELS = {
  camelCase: 'camelCase',
  pascalCase: 'PascalCase',
  snakeCase: 'snake_case',
  kebabCase: 'kebab-case',
  upperCase: 'UPPER_CASE',
  lowerCase: 'lower case',
  titleCase: 'Title Case',
  sentenceCase: 'Sentence case',
  dotCase: 'dot.case',
  screamingSnakeCase: 'SCREAMING-SNAKE-CASE',
} as const

const TOTAL_CASE_VARIANT_COUNT = 10

// Regex that matches a capital letter preceded by a lowercase letter (camelCase boundary).
const CAMEL_CASE_BOUNDARY_REGEX = /([a-z])([A-Z])/g

// Matches one or more whitespace characters, hyphens, or underscores used as word separators.
const WORD_SEPARATOR_REGEX = /[\s\-_]+/

// Detects whether a string contains any HTML tag.
const HTML_TAG_REGEX = /<[^>]+>/

// ── DOM walker helper ──

/**
 * Recursively walks a DOM node, converting its content to a Markdown string.
 * Handles headings, bold, italic, links, code, lists, and paragraphs.
 */
function walkNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()
  const childrenMarkdown = Array.from(element.childNodes).map(walkNodeToMarkdown).join('')

  switch (tagName) {
    case 'h1':
      return `# ${childrenMarkdown}\n\n`
    case 'h2':
      return `## ${childrenMarkdown}\n\n`
    case 'h3':
      return `### ${childrenMarkdown}\n\n`
    case 'h4':
      return `#### ${childrenMarkdown}\n\n`
    case 'strong':
    case 'b':
      return `**${childrenMarkdown}**`
    case 'em':
    case 'i':
      return `*${childrenMarkdown}*`
    case 'code':
      return `\`${childrenMarkdown}\``
    case 'a': {
      const hrefValue = element.getAttribute('href') ?? ''
      return `[${childrenMarkdown}](${hrefValue})`
    }
    case 'br':
      return '\n'
    case 'p':
      return `${childrenMarkdown}\n\n`
    case 'li': {
      const parentTagName = element.parentElement?.tagName.toLowerCase()
      if (parentTagName === 'ol') {
        // Numbered list item — find position among siblings
        const siblingIndex =
          Array.from(element.parentElement?.children ?? []).indexOf(element) + 1
        return `${siblingIndex}. ${childrenMarkdown}\n`
      }
      return `- ${childrenMarkdown}\n`
    }
    case 'ul':
    case 'ol':
      return `${childrenMarkdown}\n`
    default:
      return childrenMarkdown
  }
}

// ── Heading extraction helper for structured mode ──

/** Extracts heading elements from a DOM element and returns an indented outline string. */
function buildStructuredOutline(container: HTMLElement): string {
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const outlineLines: string[] = []

  for (const heading of Array.from(headings)) {
    const headingLevel = parseInt(heading.tagName[1], 10) - 1
    const indentation = '  '.repeat(headingLevel)
    outlineLines.push(`${indentation}${heading.textContent ?? ''}`)
  }

  return outlineLines.join('\n')
}

// ── Token splitter ──

/**
 * Splits an input string into normalised lowercase word tokens.
 * Handles: whitespace, hyphens, underscores, and camelCase / PascalCase boundaries.
 */
function splitIntoWordTokens(rawInput: string): string[] {
  // Insert a space before each capital letter that follows a lowercase letter (camelCase split).
  const withBoundaries = rawInput.replace(CAMEL_CASE_BOUNDARY_REGEX, '$1 $2')
  return withBoundaries
    .split(WORD_SEPARATOR_REGEX)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0)
}

// ── Exported transformation functions ──

/**
 * Converts a plain-text or HTML string to Markdown.
 * If no HTML tags are detected, the input is returned unchanged.
 */
export function convertToMarkdown(rawInput: string): string {
  if (!HTML_TAG_REGEX.test(rawInput)) {
    return rawInput
  }

  const container = document.createElement('div')
  container.innerHTML = rawInput

  return Array.from(container.childNodes).map(walkNodeToMarkdown).join('').trim()
}

/**
 * Strips all HTML tags and normalises whitespace, returning plain readable text.
 */
export function convertToPlainText(rawInput: string): string {
  const container = document.createElement('div')
  container.innerHTML = rawInput
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Preserves heading hierarchy as an indented text outline.
 * Falls back to plain text when no headings are present.
 */
export function convertToStructured(rawInput: string): string {
  if (!HTML_TAG_REGEX.test(rawInput)) {
    return rawInput
  }

  const container = document.createElement('div')
  container.innerHTML = rawInput
  const outline = buildStructuredOutline(container)

  return outline.length > 0 ? outline : convertToPlainText(rawInput)
}

/**
 * Formats a JSON string with the given indent level.
 * An indent of 0 minifies the output.
 * Returns an errorMessage when the input is not valid JSON.
 */
export function formatJson(
  rawInput: string,
  indentSize: number,
): { output: string; errorMessage: string | null } {
  try {
    const parsedValue: unknown = JSON.parse(rawInput)
    const output = JSON.stringify(parsedValue, null, indentSize)
    return { output, errorMessage: null }
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError)
    return { output: '', errorMessage: message }
  }
}

/**
 * Returns all 10 case variants of the input string.
 * Empty input produces variants with empty values.
 */
export function buildCaseVariants(rawInput: string): CaseVariant[] {
  const wordTokens = splitIntoWordTokens(rawInput)

  if (wordTokens.length === 0) {
    // Return all 10 variants with empty values when input is empty.
    return Object.values(CASE_VARIANT_LABELS).map((variantLabel) => ({
      label: variantLabel,
      value: '',
    }))
  }

  const capitaliseFirst = (token: string): string =>
    token.length === 0 ? token : token[0].toUpperCase() + token.slice(1)

  const camelCaseValue =
    wordTokens[0] + wordTokens.slice(1).map(capitaliseFirst).join('')
  const pascalCaseValue = wordTokens.map(capitaliseFirst).join('')
  const snakeCaseValue = wordTokens.join('_')
  const kebabCaseValue = wordTokens.join('-')
  const upperCaseValue = wordTokens.join('_').toUpperCase()
  const lowerCaseValue = wordTokens.join(' ')
  const titleCaseValue = wordTokens.map(capitaliseFirst).join(' ')
  const sentenceCaseValue = capitaliseFirst(wordTokens.join(' '))
  const dotCaseValue = wordTokens.join('.')
  const screamingSnakeCaseValue = wordTokens.join('-').toUpperCase()

  const variants: CaseVariant[] = [
    { label: CASE_VARIANT_LABELS.camelCase, value: camelCaseValue },
    { label: CASE_VARIANT_LABELS.pascalCase, value: pascalCaseValue },
    { label: CASE_VARIANT_LABELS.snakeCase, value: snakeCaseValue },
    { label: CASE_VARIANT_LABELS.kebabCase, value: kebabCaseValue },
    { label: CASE_VARIANT_LABELS.upperCase, value: upperCaseValue },
    { label: CASE_VARIANT_LABELS.lowerCase, value: lowerCaseValue },
    { label: CASE_VARIANT_LABELS.titleCase, value: titleCaseValue },
    { label: CASE_VARIANT_LABELS.sentenceCase, value: sentenceCaseValue },
    { label: CASE_VARIANT_LABELS.dotCase, value: dotCaseValue },
    { label: CASE_VARIANT_LABELS.screamingSnakeCase, value: screamingSnakeCaseValue },
  ]

  // Ensure exactly TOTAL_CASE_VARIANT_COUNT variants are always returned.
  if (variants.length !== TOTAL_CASE_VARIANT_COUNT) {
    throw new Error(`Expected ${TOTAL_CASE_VARIANT_COUNT} case variants, got ${variants.length}`)
  }

  return variants
}

/**
 * Encodes or decodes a URL string per the selected operation and scope.
 * Returns an errorMessage when decode fails due to malformed input.
 */
export function transformUrl(
  rawInput: string,
  operation: UrlOperation,
  scope: UrlScope,
): { output: string; errorMessage: string | null } {
  try {
    if (operation === 'encode') {
      const encodedOutput =
        scope === 'component' ? encodeURIComponent(rawInput) : encodeURI(rawInput)
      return { output: encodedOutput, errorMessage: null }
    }

    // Decode operation
    const decodedOutput =
      scope === 'component' ? decodeURIComponent(rawInput) : decodeURI(rawInput)
    return { output: decodedOutput, errorMessage: null }
  } catch (uriError) {
    const message = uriError instanceof Error ? uriError.message : String(uriError)
    return { output: '', errorMessage: message }
  }
}

/**
 * Encodes or decodes a Base64 string.
 * Unicode-safe via encodeURIComponent/escape round-trip.
 * Returns an errorMessage when decode fails due to invalid Base64 input.
 */
export function transformBase64(
  rawInput: string,
  operation: Base64Operation,
): { output: string; errorMessage: string | null } {
  try {
    if (operation === 'encode') {
      // Use encodeURIComponent + unescape for full Unicode support.
      const encodedOutput = btoa(unescape(encodeURIComponent(rawInput)))
      return { output: encodedOutput, errorMessage: null }
    }

    // Decode: atob then re-encode to handle Unicode characters.
    const decodedOutput = decodeURIComponent(escape(atob(rawInput)))
    return { output: decodedOutput, errorMessage: null }
  } catch (base64Error) {
    const message = base64Error instanceof Error ? base64Error.message : String(base64Error)
    return { output: '', errorMessage: message }
  }
}
