// serviceNowExtractorBookmarklet.ts — Builds the in-page ServiceNow extractor bookmarklet used by Text Tools.

const BOOKMARKLET_PROTOCOL = 'javascript:'

const SERVICE_NOW_EXTRACTOR_BOOKMARKLET_SOURCE = String.raw`
(() => {
  const OVERLAY_ATTRIBUTE = 'data-ntbx-snow-extractor'
  const OVERLAY_SELECTOR = '[' + OVERLAY_ATTRIBUTE + ']'
  const STYLE_ELEMENT_ID = 'ntbx-snow-extractor-style'
  const CONTROL_SELECTOR = 'input[name],select[name],textarea[name],input[id],select[id],textarea[id]'
  const DISPLAY_FIELD_PREFIX = 'sys_display.'
  const CHANGE_REQUEST_PREFIX = 'change_request.'
  const SKIPPED_FIELD_PREFIXES = ['sysparm_', 'sys_original.', 'ni.', 'sys_readonly.']
  const SKIPPED_FIELD_NAMES = new Set(['sysverb_update', 'sysverb_insert', 'sys_target'])
  const EXTRACTOR_NAME = 'NodeToolbox SNow Field Extractor'
  const EMPTY_VALUE = ''

  function trimText(rawValue) {
    return typeof rawValue === 'string' ? rawValue.replace(/\s+/g, ' ').trim() : EMPTY_VALUE
  }

  function cleanLabel(rawLabel, fallbackLabel) {
    const cleanedLabel = trimText(rawLabel).replace(/^\*+\s*/, '')
    return cleanedLabel || fallbackLabel
  }

  function getAttributeValue(element, attributeName) {
    return trimText(element.getAttribute(attributeName))
  }

  function shouldSkipRawFieldName(rawFieldName) {
    if (!rawFieldName) return true
    if (SKIPPED_FIELD_NAMES.has(rawFieldName)) return true
    return SKIPPED_FIELD_PREFIXES.some((skippedPrefix) => rawFieldName.startsWith(skippedPrefix))
  }

  function normalizeFieldName(rawFieldName) {
    let normalizedFieldName = rawFieldName
    if (normalizedFieldName.startsWith(DISPLAY_FIELD_PREFIX)) {
      normalizedFieldName = normalizedFieldName.slice(DISPLAY_FIELD_PREFIX.length)
    }
    if (normalizedFieldName.startsWith(CHANGE_REQUEST_PREFIX)) {
      normalizedFieldName = normalizedFieldName.slice(CHANGE_REQUEST_PREFIX.length)
    }
    const fieldNameParts = normalizedFieldName.split('.')
    return trimText(fieldNameParts[fieldNameParts.length - 1] || normalizedFieldName)
  }

  function getRawFieldName(controlElement) {
    return getAttributeValue(controlElement, 'name')
      || getAttributeValue(controlElement, 'id')
      || getAttributeValue(controlElement, 'data-name')
      || getAttributeValue(controlElement, 'aria-label')
  }

  function getRootDocument(searchRoot) {
    return searchRoot.nodeType === Node.DOCUMENT_NODE ? searchRoot : searchRoot.ownerDocument
  }

  function findElementById(searchRoot, targetId) {
    if (!targetId) return null
    if (typeof searchRoot.getElementById === 'function') {
      const rootElement = searchRoot.getElementById(targetId)
      if (rootElement) return rootElement
    }
    const rootDocument = getRootDocument(searchRoot)
    if (rootDocument && typeof rootDocument.getElementById === 'function') {
      return rootDocument.getElementById(targetId)
    }
    return null
  }

  function getTextFromLabelledBy(searchRoot, controlElement) {
    const labelledByValue = getAttributeValue(controlElement, 'aria-labelledby')
    if (!labelledByValue) return EMPTY_VALUE
    return labelledByValue
      .split(/\s+/)
      .map((labelElementId) => findElementById(searchRoot, labelElementId))
      .filter(Boolean)
      .map((labelElement) => trimText(labelElement.textContent))
      .filter(Boolean)
      .join(' ')
  }

  function getTextFromForLabel(searchRoot, controlElement) {
    const controlId = getAttributeValue(controlElement, 'id')
    if (!controlId) return EMPTY_VALUE
    return Array.from(searchRoot.querySelectorAll('label')).reduce((matchedLabelText, labelElement) => {
      if (matchedLabelText) return matchedLabelText
      return getAttributeValue(labelElement, 'for') === controlId ? trimText(labelElement.textContent) : EMPTY_VALUE
    }, EMPTY_VALUE)
  }

  function getServiceNowLabel(searchRoot, rawFieldName) {
    const serviceNowLabelElement = findElementById(searchRoot, 'label.' + rawFieldName)
    return serviceNowLabelElement ? trimText(serviceNowLabelElement.textContent) : EMPTY_VALUE
  }

  function getNearbyLabel(controlElement) {
    const closestLabelElement = controlElement.closest('label')
    if (closestLabelElement) return trimText(closestLabelElement.textContent)

    let currentElement = controlElement.parentElement
    let ancestorDepth = 0
    while (currentElement && ancestorDepth < 4) {
      let previousElement = currentElement.previousElementSibling
      while (previousElement) {
        const previousText = trimText(previousElement.textContent)
        if (previousText) return previousText
        previousElement = previousElement.previousElementSibling
      }
      currentElement = currentElement.parentElement
      ancestorDepth += 1
    }

    return EMPTY_VALUE
  }

  function getControlLabel(searchRoot, controlElement, rawFieldName, normalizedFieldName) {
    return cleanLabel(
      getTextFromForLabel(searchRoot, controlElement)
        || getTextFromLabelledBy(searchRoot, controlElement)
        || getAttributeValue(controlElement, 'aria-label')
        || getServiceNowLabel(searchRoot, rawFieldName)
        || getNearbyLabel(controlElement),
      normalizedFieldName,
    )
  }

  function getParentElementAcrossRoots(element) {
    if (element.parentElement) return element.parentElement
    const rootNode = element.getRootNode && element.getRootNode()
    return rootNode && rootNode.host ? rootNode.host : null
  }

  function isControlVisible(controlElement) {
    if (getAttributeValue(controlElement, 'type').toLowerCase() === 'hidden') return false
    let currentElement = controlElement
    while (currentElement) {
      if (currentElement.hidden || getAttributeValue(currentElement, 'aria-hidden') === 'true') return false
      const inlineStyle = currentElement.style
      if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) return false
      currentElement = getParentElementAcrossRoots(currentElement)
    }
    return true
  }

  function getControlChoices(controlElement) {
    if (controlElement.tagName.toLowerCase() !== 'select') return []
    return Array.from(controlElement.options).map((optionElement) => ({
      value: trimText(optionElement.value),
      label: trimText(optionElement.textContent),
    }))
  }

  function getSelectedChoiceLabel(controlElement, choices) {
    if (controlElement.tagName.toLowerCase() !== 'select') return EMPTY_VALUE
    const selectedValue = trimText(controlElement.value)
    const selectedChoice = choices.find((choiceOption) => choiceOption.value === selectedValue)
    return selectedChoice ? selectedChoice.label : selectedValue
  }

  function collectSearchRootsFromRoot(searchRoot, sourceLabel, collectedRoots, visitedRoots) {
    if (!searchRoot || visitedRoots.has(searchRoot)) return
    visitedRoots.add(searchRoot)
    collectedRoots.push({ searchRoot, sourceLabel })

    Array.from(searchRoot.querySelectorAll('*')).forEach((candidateElement) => {
      if (candidateElement.shadowRoot) {
        collectSearchRootsFromRoot(candidateElement.shadowRoot, sourceLabel + ' > open shadow root', collectedRoots, visitedRoots)
      }

      if (candidateElement.tagName.toLowerCase() === 'iframe') {
        try {
          const iframeDocument = candidateElement.contentDocument || (candidateElement.contentWindow && candidateElement.contentWindow.document)
          if (iframeDocument) {
            collectSearchRootsFromRoot(iframeDocument, sourceLabel + ' > iframe', collectedRoots, visitedRoots)
          }
        } catch (unknownError) {
          // Cross-origin ServiceNow frames are skipped because browsers intentionally block access to them.
        }
      }
    })
  }

  function collectSearchRoots() {
    const collectedRoots = []
    collectSearchRootsFromRoot(document, 'current page', collectedRoots, new Set())
    return collectedRoots
  }

  function createEmptyFieldRecord(fieldName, label, sourceLabel, isVisible) {
    return {
      fieldName,
      label,
      value: EMPTY_VALUE,
      displayValue: EMPTY_VALUE,
      choices: [],
      sourceNames: [],
      sourceLabel,
      isVisible,
    }
  }

  function mergeControlIntoFieldRecord(fieldRecordsByName, searchRoot, sourceLabel, controlElement) {
    if (controlElement.closest(OVERLAY_SELECTOR)) return

    const rawFieldName = getRawFieldName(controlElement)
    if (shouldSkipRawFieldName(rawFieldName)) return

    const fieldName = normalizeFieldName(rawFieldName)
    if (!fieldName) return

    const isVisible = isControlVisible(controlElement)
    const fieldLabel = getControlLabel(searchRoot, controlElement, rawFieldName, fieldName)
    const existingFieldRecord = fieldRecordsByName.get(fieldName)
    const fieldRecord = existingFieldRecord || createEmptyFieldRecord(fieldName, fieldLabel, sourceLabel, isVisible)
    const controlValue = trimText(controlElement.value)
    const isDisplayField = rawFieldName.startsWith(DISPLAY_FIELD_PREFIX)
    const controlChoices = getControlChoices(controlElement)
    const selectedChoiceLabel = getSelectedChoiceLabel(controlElement, controlChoices)
    const displayValue = selectedChoiceLabel || controlValue

    fieldRecord.label = fieldRecord.label === fieldName || isVisible ? fieldLabel : fieldRecord.label
    fieldRecord.isVisible = fieldRecord.isVisible || isVisible
    fieldRecord.sourceLabel = fieldRecord.sourceLabel || sourceLabel
    if (!fieldRecord.sourceNames.includes(rawFieldName)) fieldRecord.sourceNames.push(rawFieldName)

    if (controlElement.tagName.toLowerCase() === 'select') {
      fieldRecord.value = controlValue
      fieldRecord.displayValue = displayValue
      fieldRecord.choices = controlChoices
    } else if (getAttributeValue(controlElement, 'type').toLowerCase() === 'checkbox') {
      fieldRecord.value = controlElement.checked ? 'true' : 'false'
      fieldRecord.displayValue = fieldRecord.value
    } else if (getAttributeValue(controlElement, 'type').toLowerCase() === 'radio') {
      if (!controlElement.checked) return
      fieldRecord.value = controlValue
      fieldRecord.displayValue = displayValue
    } else if (isDisplayField) {
      fieldRecord.displayValue = controlValue || fieldRecord.displayValue
    } else {
      fieldRecord.value = controlValue
      if (!fieldRecord.displayValue || isVisible) fieldRecord.displayValue = controlValue
    }

    fieldRecordsByName.set(fieldName, fieldRecord)
  }

  function scanServiceNowFields() {
    const fieldRecordsByName = new Map()
    const searchRoots = collectSearchRoots()

    searchRoots.forEach((searchRootRecord) => {
      Array.from(searchRootRecord.searchRoot.querySelectorAll(CONTROL_SELECTOR)).forEach((controlElement) => {
        mergeControlIntoFieldRecord(
          fieldRecordsByName,
          searchRootRecord.searchRoot,
          searchRootRecord.sourceLabel,
          controlElement,
        )
      })
    })

    return {
      fieldRecords: Array.from(fieldRecordsByName.values()).sort((firstField, secondField) => (
        firstField.fieldName.localeCompare(secondField.fieldName)
      )),
      scannedRootCount: searchRoots.length,
    }
  }

  function createElement(tagName, className, textContent) {
    const createdElement = document.createElement(tagName)
    if (className) createdElement.className = className
    if (textContent) createdElement.textContent = textContent
    return createdElement
  }

  function installOverlayStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) return
    const styleElement = document.createElement('style')
    styleElement.id = STYLE_ELEMENT_ID
    styleElement.textContent = [
      OVERLAY_SELECTOR + '{position:fixed;z-index:2147483647;right:18px;top:18px;width:min(760px,calc(100vw - 36px));max-height:calc(100vh - 36px);display:flex;flex-direction:column;gap:10px;background:#10131a;color:#f8fafc;border:1px solid #64748b;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.45);font-family:Arial,sans-serif;font-size:13px;padding:14px;}',
      OVERLAY_SELECTOR + ' *{box-sizing:border-box;}',
      OVERLAY_SELECTOR + ' button{border:1px solid #64748b;border-radius:8px;background:#1e293b;color:#f8fafc;padding:7px 10px;cursor:pointer;}',
      OVERLAY_SELECTOR + ' button:hover{background:#334155;}',
      OVERLAY_SELECTOR + ' .ntbx-header{display:flex;align-items:center;justify-content:space-between;gap:10px;}',
      OVERLAY_SELECTOR + ' .ntbx-title{font-size:16px;font-weight:700;}',
      OVERLAY_SELECTOR + ' .ntbx-actions{display:flex;gap:8px;flex-wrap:wrap;}',
      OVERLAY_SELECTOR + ' .ntbx-status{color:#cbd5e1;}',
      OVERLAY_SELECTOR + ' .ntbx-list{border:1px solid #334155;border-radius:10px;overflow:auto;max-height:340px;background:#020617;}',
      OVERLAY_SELECTOR + ' .ntbx-row{display:grid;grid-template-columns:24px 1fr;gap:8px;padding:8px 10px;border-bottom:1px solid #1e293b;}',
      OVERLAY_SELECTOR + ' .ntbx-row:last-child{border-bottom:0;}',
      OVERLAY_SELECTOR + ' .ntbx-name{font-family:Consolas,monospace;color:#93c5fd;}',
      OVERLAY_SELECTOR + ' .ntbx-preview{display:block;margin-top:3px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      OVERLAY_SELECTOR + ' .ntbx-meta{display:block;margin-top:3px;color:#94a3b8;font-size:12px;}',
      OVERLAY_SELECTOR + ' textarea{width:100%;min-height:120px;background:#020617;color:#f8fafc;border:1px solid #334155;border-radius:10px;padding:8px;font-family:Consolas,monospace;font-size:12px;}',
    ].join('')
    document.head.appendChild(styleElement)
  }

  function buildPayload(fieldRecords, scannedRootCount) {
    const selectedFieldRecords = fieldRecords.filter((fieldRecord) => fieldRecord.checkboxElement && fieldRecord.checkboxElement.checked)
    const fields = {}
    const choiceOptions = {}

    selectedFieldRecords.forEach((fieldRecord) => {
      fields[fieldRecord.fieldName] = {
        label: fieldRecord.label,
        value: fieldRecord.value,
        displayValue: fieldRecord.displayValue,
        sourceNames: fieldRecord.sourceNames,
      }
      if (fieldRecord.choices.length > 0) {
        fields[fieldRecord.fieldName].choices = fieldRecord.choices
        choiceOptions[fieldRecord.fieldName] = fieldRecord.choices
      }
    })

    return {
      extractor: EXTRACTOR_NAME,
      source: 'servicenow-form',
      sourceDetails: {
        scannedRoots: scannedRootCount,
        selectedFields: selectedFieldRecords.length,
      },
      extractedAt: new Date().toISOString(),
      page: {
        title: document.title,
        href: window.location.href,
      },
      fields,
      choiceOptions,
    }
  }

  function renderFieldRows(listElement, fieldRecords, previewElement, scannedRootCount) {
    listElement.textContent = EMPTY_VALUE

    fieldRecords.forEach((fieldRecord) => {
      const rowElement = createElement('label', 'ntbx-row')
      const checkboxElement = document.createElement('input')
      checkboxElement.type = 'checkbox'
      checkboxElement.checked = fieldRecord.isVisible
      checkboxElement.addEventListener('change', () => updatePreview(previewElement, fieldRecords, scannedRootCount))
      fieldRecord.checkboxElement = checkboxElement

      const detailElement = createElement('span', '')
      const fieldNameElement = createElement('span', 'ntbx-name', fieldRecord.fieldName)
      const labelElement = createElement('strong', '', ' ' + fieldRecord.label)
      const previewValueElement = createElement('span', 'ntbx-preview', fieldRecord.displayValue || fieldRecord.value || '(empty)')
      const metadataElement = createElement(
        'span',
        'ntbx-meta',
        (fieldRecord.isVisible ? 'visible' : 'hidden/paired') + ' • ' + fieldRecord.sourceNames.join(', '),
      )

      detailElement.append(fieldNameElement, labelElement, previewValueElement, metadataElement)
      rowElement.append(checkboxElement, detailElement)
      listElement.appendChild(rowElement)
    })

    updatePreview(previewElement, fieldRecords, scannedRootCount)
  }

  function updatePreview(previewElement, fieldRecords, scannedRootCount) {
    previewElement.value = JSON.stringify(buildPayload(fieldRecords, scannedRootCount), null, 2)
  }

  function createOverlay() {
    const existingOverlay = document.querySelector(OVERLAY_SELECTOR)
    if (existingOverlay) existingOverlay.remove()

    installOverlayStyles()

    const overlayElement = createElement('section', '')
    overlayElement.setAttribute(OVERLAY_ATTRIBUTE, 'true')
    overlayElement.setAttribute('role', 'dialog')
    overlayElement.setAttribute('aria-label', EXTRACTOR_NAME)

    const headerElement = createElement('div', 'ntbx-header')
    const titleElement = createElement('div', 'ntbx-title', EXTRACTOR_NAME)
    const closeButton = createElement('button', '', 'Close')
    closeButton.addEventListener('click', () => overlayElement.remove())
    headerElement.append(titleElement, closeButton)

    const statusElement = createElement('div', 'ntbx-status', 'Scanning visible ServiceNow fields...')
    const actionsElement = createElement('div', 'ntbx-actions')
    const scanButton = createElement('button', '', 'Scan fields')
    const selectVisibleButton = createElement('button', '', 'Select visible')
    const selectAllButton = createElement('button', '', 'Select all')
    const clearButton = createElement('button', '', 'Clear selection')
    const copyButton = createElement('button', '', 'Copy selected JSON')
    actionsElement.append(scanButton, selectVisibleButton, selectAllButton, clearButton, copyButton)

    const listElement = createElement('div', 'ntbx-list')
    const previewElement = document.createElement('textarea')
    previewElement.setAttribute('aria-label', 'Extractor JSON preview')

    let currentFieldRecords = []
    let currentScannedRootCount = 0

    function setAllSelections(shouldSelectFields) {
      currentFieldRecords.forEach((fieldRecord) => {
        if (fieldRecord.checkboxElement) fieldRecord.checkboxElement.checked = shouldSelectFields(fieldRecord)
      })
      updatePreview(previewElement, currentFieldRecords, currentScannedRootCount)
    }

    function scanAndRenderFields() {
      const scanResult = scanServiceNowFields()
      currentFieldRecords = scanResult.fieldRecords
      currentScannedRootCount = scanResult.scannedRootCount
      statusElement.textContent = currentFieldRecords.length === 0
        ? 'No fields found. Leave this panel open, inspect a visible SNow input, then click Scan fields again.'
        : 'Found ' + currentFieldRecords.length + ' field(s) across ' + scanResult.scannedRootCount + ' document/shadow root(s). Review selections before copying.'
      renderFieldRows(listElement, currentFieldRecords, previewElement, currentScannedRootCount)
    }

    scanButton.addEventListener('click', scanAndRenderFields)
    selectVisibleButton.addEventListener('click', () => setAllSelections((fieldRecord) => fieldRecord.isVisible))
    selectAllButton.addEventListener('click', () => setAllSelections(() => true))
    clearButton.addEventListener('click', () => setAllSelections(() => false))
    copyButton.addEventListener('click', () => {
      updatePreview(previewElement, currentFieldRecords, currentScannedRootCount)
      const previewJson = previewElement.value
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(previewJson).then(() => {
          statusElement.textContent = 'Copied selected JSON. Paste it into SNow Hub CRG Configuration.'
        }).catch(() => {
          window.prompt(EXTRACTOR_NAME + ': Copy this JSON', previewJson)
        })
      } else {
        window.prompt(EXTRACTOR_NAME + ': Copy this JSON', previewJson)
      }
    })

    overlayElement.append(headerElement, statusElement, actionsElement, listElement, previewElement)
    document.body.appendChild(overlayElement)
    scanAndRenderFields()
  }

  createOverlay()
})()
`

/**
 * Builds an encoded ServiceNow extractor bookmarklet href.
 *
 * The source is URL-encoded so the installed bookmarklet never contains raw
 * line breaks, which browsers can silently ignore in javascript: URLs.
 */
export function buildServiceNowExtractorBookmarkletHref(): string {
  return `${BOOKMARKLET_PROTOCOL}${encodeURIComponent(SERVICE_NOW_EXTRACTOR_BOOKMARKLET_SOURCE)}`
}
