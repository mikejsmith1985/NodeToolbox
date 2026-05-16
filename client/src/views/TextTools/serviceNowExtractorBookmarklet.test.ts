// serviceNowExtractorBookmarklet.test.ts — Verifies the ServiceNow extractor bookmarklet against real form patterns.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildServiceNowExtractorBookmarkletHref } from './serviceNowExtractorBookmarklet.ts'

const BOOKMARKLET_PREFIX = 'javascript:'

function runExtractorBookmarklet() {
  const bookmarkletHref = buildServiceNowExtractorBookmarkletHref()
  const encodedBookmarkletSource = bookmarkletHref.slice(BOOKMARKLET_PREFIX.length)
  const decodedBookmarkletSource = decodeURIComponent(encodedBookmarkletSource)

  new Function(decodedBookmarkletSource)()
}

function getClipboardPayload(writeTextMock: ReturnType<typeof vi.fn>) {
  const copiedJson = writeTextMock.mock.calls.at(-1)?.[0]
  expect(copiedJson).toBeTypeOf('string')
  return JSON.parse(String(copiedJson)) as {
    fields: Record<string, { label: string; value: string; displayValue: string }>
    choiceOptions: Record<string, { value: string; label: string }[]>
  }
}

describe('buildServiceNowExtractorBookmarkletHref', () => {
  let writeTextMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a javascript bookmarklet without raw newline characters', () => {
    const bookmarkletHref = buildServiceNowExtractorBookmarkletHref()

    expect(bookmarkletHref.startsWith(BOOKMARKLET_PREFIX)).toBe(true)
    expect(bookmarkletHref).not.toContain('\n')
    expect(bookmarkletHref).not.toContain('\r')
    expect(decodeURIComponent(bookmarkletHref)).toContain('NodeToolbox SNow Field Extractor')
  })

  it('opens a GUI and extracts ServiceNow select values plus choice labels', async () => {
    document.body.innerHTML = `
      <main>
        <div class="form-row">
          <label id="label.change_request.u_implications_of_system_availability">
            * Implications on system availability
          </label>
          <select
            aria-labelledby="label.change_request.u_implications_of_system_availability"
            name="change_request.u_implications_of_system_availability"
            id="change_request.u_implications_of_system_availability"
          >
            <option value="">-- None --</option>
            <option value="c_unavail">Application or Service will be unavailable for use</option>
            <option value="c_slow">Application or Service could experience slow performance</option>
            <option value="c_avail">Application or Service would be available, but some features could be unavailable</option>
            <option value="c_func" selected>Application or Service would remain functioning as designed</option>
          </select>
        </div>
        <input type="hidden" name="sysparm_record_target" value="change_request" />
      </main>
    `

    runExtractorBookmarklet()

    expect(screenDocument().querySelector('[data-ntbx-snow-extractor]')).not.toBeNull()
    expect(screenDocument().body.textContent).toContain('u_implications_of_system_availability')
    expect(screenDocument().body.textContent).toContain('Application or Service would remain functioning as designed')

    clickExtractorButton('Copy selected JSON')
    await vi.waitFor(() => expect(writeTextMock).toHaveBeenCalled())

    const copiedPayload = getClipboardPayload(writeTextMock)
    expect(copiedPayload.fields.u_implications_of_system_availability).toMatchObject({
      label: 'Implications on system availability',
      value: 'c_func',
      displayValue: 'Application or Service would remain functioning as designed',
    })
    expect(copiedPayload.choiceOptions.u_implications_of_system_availability).toContainEqual({
      value: 'c_func',
      label: 'Application or Service would remain functioning as designed',
    })
    expect(copiedPayload.fields.sysparm_record_target).toBeUndefined()
  })

  it('scans open shadow roots so modern ServiceNow form controls are not missed', () => {
    const shadowHostElement = document.createElement('section')
    const shadowRoot = shadowHostElement.attachShadow({ mode: 'open' })
    shadowRoot.innerHTML = `
      <label id="short-description-label">Short description</label>
      <input
        aria-labelledby="short-description-label"
        name="change_request.short_description"
        value="Enrollment - Transformers deployment"
      />
    `
    document.body.appendChild(shadowHostElement)

    runExtractorBookmarklet()

    expect(screenDocument().body.textContent).toContain('short_description')
    expect(screenDocument().body.textContent).toContain('Enrollment - Transformers deployment')
  })
})

function screenDocument() {
  return document
}

function clickExtractorButton(buttonText: string) {
  const matchingButton = Array.from(document.querySelectorAll('button')).find((buttonElement) => (
    buttonElement.textContent?.trim() === buttonText
  ))

  expect(matchingButton).toBeDefined()
  matchingButton?.click()
}
