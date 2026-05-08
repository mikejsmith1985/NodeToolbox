// TextToolsView.tsx — Multi-tab text utility view with 6 transformation tools.
//
// Tabs: Smart Formatter (HTML→Markdown), JSON Formatter, Case Converter,
// URL Encoder/Decoder, Base64 Encoder/Decoder, and Element Extractor bookmarklet.

import { useState } from 'react'

import {
  buildCaseVariants,
  convertToMarkdown,
  convertToPlainText,
  convertToStructured,
  formatJson,
  transformBase64,
  transformUrl,
} from './utils/textTransformUtils.ts'
import type {
  CaseVariant,
  JsonIndentMode,
  SmartFormatterMode,
} from './utils/textTransformUtils.ts'
import { useTextToolsState } from './hooks/useTextToolsState.ts'
import type { TextToolsTab } from './hooks/useTextToolsState.ts'
import styles from './TextToolsView.module.css'

// ── Named constants ──

const VIEW_TITLE = '🛠 Text Tools'
const VIEW_SUBTITLE = 'Smart formatting, JSON, case conversion, URL/Base64 encoding, and more.'

const TAB_OPTIONS: { key: TextToolsTab; label: string }[] = [
  { key: 'smart-formatter', label: '✨ Smart Formatter' },
  { key: 'json', label: '{ } JSON' },
  { key: 'case', label: 'Aa Case' },
  { key: 'url', label: '🔗 URL' },
  { key: 'base64', label: '64 Base64' },
  { key: 'extractor', label: '🔍 Extractor' },
]

const SMART_FORMATTER_MODES: { key: SmartFormatterMode; label: string }[] = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'plain', label: 'Plain Text' },
  { key: 'structured', label: 'Structured' },
]

const JSON_INDENT_MODES: { key: JsonIndentMode; label: string }[] = [
  { key: 2, label: '2 Spaces' },
  { key: 4, label: '4 Spaces' },
  { key: 0, label: 'Minify' },
]

const CASE_INPUT_PLACEHOLDER = 'Type or paste text — all 10 formats update live'
const COPY_SUCCESS_LABEL = '✓ Copied'
const COPY_DEFAULT_LABEL = 'Copy'
const BOOKMARKLET_HREF =
  "javascript:(function(){alert('NodeToolbox Element Extractor — drag this to your bookmarks bar to activate.');})()"

// ── Helper: character/line stats bar ──

/** Renders a compact stats bar showing character and line counts. */
function StatsBar({ text }: { text: string }) {
  const charCount = text.length
  const lineCount = text === '' ? 0 : text.split('\n').length
  return (
    <span className={styles.panelStatsBar}>
      {charCount} chars · {lineCount} lines
    </span>
  )
}

// ── Helper: copy button with visual feedback ──

/** Button that copies text to the clipboard and briefly shows a success label. */
function CopyButton({ textToCopy }: { textToCopy: string }) {
  const [buttonLabel, setButtonLabel] = useState(COPY_DEFAULT_LABEL)

  function handleCopy() {
    navigator.clipboard.writeText(textToCopy).then(() => {
      setButtonLabel(COPY_SUCCESS_LABEL)
      setTimeout(() => setButtonLabel(COPY_DEFAULT_LABEL), 1500)
    })
  }

  return (
    <button className={styles.actionButton} onClick={handleCopy}>
      {buttonLabel}
    </button>
  )
}

// ── Smart Formatter tab ──

/** Resolves the formatted output based on the selected mode. */
function resolveSmartFormatterOutput(inputText: string, mode: SmartFormatterMode): string {
  if (mode === 'plain') return convertToPlainText(inputText)
  if (mode === 'structured') return convertToStructured(inputText)
  return convertToMarkdown(inputText)
}

interface SmartFormatterPanelProps {
  inputText: string
  mode: SmartFormatterMode
  onInputChange(value: string): void
  onModeChange(mode: SmartFormatterMode): void
  onClear(): void
}

/** Smart Formatter split-panel — left: raw input, right: rendered output. */
function SmartFormatterPanel({
  inputText,
  mode,
  onInputChange,
  onModeChange,
  onClear,
}: SmartFormatterPanelProps) {
  const outputText = resolveSmartFormatterOutput(inputText, mode)

  return (
    <div className={styles.splitPanel}>
      {/* Input panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Input</span>
          <button className={styles.actionButton} onClick={onClear}>
            Clear
          </button>
        </div>
        <textarea
          id="smart-formatter-input"
          aria-label="Smart Formatter Input"
          className={styles.panelTextarea}
          value={inputText}
          onChange={(changeEvent) => onInputChange(changeEvent.target.value)}
          placeholder="Paste HTML or plain text…"
        />
        <StatsBar text={inputText} />
      </div>

      {/* Output panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Output</span>
          <div className={styles.radioGroup}>
            {SMART_FORMATTER_MODES.map((modeOption) => (
              <label key={modeOption.key} className={styles.radioLabel}>
                <input
                  type="radio"
                  name="smart-formatter-mode"
                  value={modeOption.key}
                  checked={mode === modeOption.key}
                  onChange={() => onModeChange(modeOption.key)}
                />
                {modeOption.label}
              </label>
            ))}
          </div>
          <CopyButton textToCopy={outputText} />
        </div>
        <textarea
          className={styles.panelTextarea}
          value={outputText}
          readOnly
          aria-label="Smart Formatter Output"
        />
        <StatsBar text={outputText} />
      </div>
    </div>
  )
}

// ── JSON Formatter tab ──

interface JsonFormatterPanelProps {
  inputText: string
  indentMode: JsonIndentMode
  onInputChange(value: string): void
  onIndentModeChange(mode: JsonIndentMode): void
  onClear(): void
}

/** JSON Formatter split-panel — parses and re-serialises with chosen indent. */
function JsonFormatterPanel({
  inputText,
  indentMode,
  onInputChange,
  onIndentModeChange,
  onClear,
}: JsonFormatterPanelProps) {
  const { output: formattedOutput, errorMessage } = formatJson(inputText, indentMode)

  return (
    <div className={styles.splitPanel}>
      {/* Input panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Input</span>
          <button className={styles.actionButton} onClick={onClear}>
            Clear
          </button>
        </div>
        <textarea
          id="json-input"
          aria-label="JSON Input"
          className={styles.panelTextarea}
          value={inputText}
          onChange={(changeEvent) => onInputChange(changeEvent.target.value)}
          placeholder='{"key": "value"}'
        />
        {errorMessage !== null && <div className={styles.errorBar}>{errorMessage}</div>}
      </div>

      {/* Output panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Output</span>
          <div className={styles.radioGroup}>
            {JSON_INDENT_MODES.map((indentOption) => (
              <label key={indentOption.key} className={styles.radioLabel}>
                <input
                  type="radio"
                  name="json-indent-mode"
                  value={String(indentOption.key)}
                  checked={indentMode === indentOption.key}
                  onChange={() => onIndentModeChange(indentOption.key)}
                />
                {indentOption.label}
              </label>
            ))}
          </div>
          <CopyButton textToCopy={formattedOutput} />
        </div>
        <textarea
          className={styles.panelTextarea}
          value={formattedOutput}
          readOnly
          aria-label="JSON Output"
        />
        <StatsBar text={formattedOutput} />
      </div>
    </div>
  )
}

// ── Case Converter tab ──

interface CaseVariantCardProps {
  variant: CaseVariant
}

/** Single case variant card showing the label, value, and a copy icon button. */
function CaseVariantCard({ variant }: CaseVariantCardProps) {
  function handleCopy() {
    navigator.clipboard.writeText(variant.value)
  }

  return (
    <div className={styles.caseVariantCard}>
      <span className={styles.caseVariantLabel}>{variant.label}</span>
      <div className={styles.caseVariantValueRow}>
        <span className={styles.caseVariantValue}>{variant.value}</span>
        <button
          className={styles.copyIconButton}
          onClick={handleCopy}
          aria-label={`Copy ${variant.label}`}
          title="Copy"
        >
          📋
        </button>
      </div>
    </div>
  )
}

interface CaseConverterPanelProps {
  inputText: string
  onInputChange(value: string): void
}

/** Case Converter — full-width input + grid of 10 live variant cards. */
function CaseConverterPanel({ inputText, onInputChange }: CaseConverterPanelProps) {
  const caseVariants = buildCaseVariants(inputText)

  return (
    <div className={styles.caseConverterPanel}>
      <textarea
        id="case-input"
        aria-label="Case Converter Input"
        className={styles.caseInputArea}
        value={inputText}
        onChange={(changeEvent) => onInputChange(changeEvent.target.value)}
        placeholder={CASE_INPUT_PLACEHOLDER}
      />
      <div className={styles.caseVariantsGrid}>
        {caseVariants.map((caseVariant) => (
          <CaseVariantCard key={caseVariant.label} variant={caseVariant} />
        ))}
      </div>
    </div>
  )
}

// ── URL Encoder tab ──

interface UrlEncoderPanelProps {
  inputText: string
  urlOperation: 'encode' | 'decode'
  urlScope: 'component' | 'full'
  onInputChange(value: string): void
  onOperationChange(op: 'encode' | 'decode'): void
  onScopeChange(scope: 'component' | 'full'): void
  onClear(): void
}

/** URL Encoder/Decoder split-panel. */
function UrlEncoderPanel({
  inputText,
  urlOperation,
  urlScope,
  onInputChange,
  onOperationChange,
  onScopeChange,
  onClear,
}: UrlEncoderPanelProps) {
  const { output: encodedOutput, errorMessage } = transformUrl(inputText, urlOperation, urlScope)

  return (
    <div className={styles.splitPanel}>
      {/* Input panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Input</span>
          <button className={styles.actionButton} onClick={onClear}>
            Clear
          </button>
        </div>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="url-operation"
              value="encode"
              checked={urlOperation === 'encode'}
              onChange={() => onOperationChange('encode')}
            />
            Encode
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="url-operation"
              value="decode"
              checked={urlOperation === 'decode'}
              onChange={() => onOperationChange('decode')}
            />
            Decode
          </label>
        </div>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="url-scope"
              value="component"
              checked={urlScope === 'component'}
              onChange={() => onScopeChange('component')}
            />
            Component
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="url-scope"
              value="full"
              checked={urlScope === 'full'}
              onChange={() => onScopeChange('full')}
            />
            Full URI
          </label>
        </div>
        <textarea
          id="url-input"
          aria-label="URL Input"
          className={styles.panelTextarea}
          value={inputText}
          onChange={(changeEvent) => onInputChange(changeEvent.target.value)}
          placeholder="Paste URL or component string…"
        />
      </div>

      {/* Output panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Output</span>
          <CopyButton textToCopy={encodedOutput} />
        </div>
        <textarea
          className={styles.panelTextarea}
          value={encodedOutput}
          readOnly
          aria-label="URL Output"
        />
        {errorMessage !== null && <div className={styles.errorBar}>{errorMessage}</div>}
      </div>
    </div>
  )
}

// ── Base64 tab ──

interface Base64PanelProps {
  inputText: string
  base64Operation: 'encode' | 'decode'
  onInputChange(value: string): void
  onOperationChange(op: 'encode' | 'decode'): void
  onClear(): void
}

/** Base64 Encoder/Decoder split-panel. */
function Base64Panel({
  inputText,
  base64Operation,
  onInputChange,
  onOperationChange,
  onClear,
}: Base64PanelProps) {
  const { output: convertedOutput, errorMessage } = transformBase64(inputText, base64Operation)

  return (
    <div className={styles.splitPanel}>
      {/* Input panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Input</span>
          <button className={styles.actionButton} onClick={onClear}>
            Clear
          </button>
        </div>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="base64-operation"
              value="encode"
              checked={base64Operation === 'encode'}
              onChange={() => onOperationChange('encode')}
            />
            Encode → Base64
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="base64-operation"
              value="decode"
              checked={base64Operation === 'decode'}
              onChange={() => onOperationChange('decode')}
            />
            Decode ← Base64
          </label>
        </div>
        <textarea
          id="base64-input"
          aria-label="Base64 Input"
          className={styles.panelTextarea}
          value={inputText}
          onChange={(changeEvent) => onInputChange(changeEvent.target.value)}
          placeholder="Paste text or Base64 string…"
        />
      </div>

      {/* Output panel */}
      <div className={styles.panelCard}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Output</span>
          <CopyButton textToCopy={convertedOutput} />
        </div>
        <textarea
          className={styles.panelTextarea}
          value={convertedOutput}
          readOnly
          aria-label="Base64 Output"
        />
        {errorMessage !== null && <div className={styles.errorBar}>{errorMessage}</div>}
      </div>
    </div>
  )
}

// ── Element Extractor tab ──

/** Static information and bookmarklet installer for the Element Extractor tool. */
function ElementExtractorPanel() {
  return (
    <div className={styles.extractorPanel}>
      <div className={styles.infoCard}>
        <h3 className={styles.infoCardTitle}>What this does</h3>
        <p className={styles.infoCardBody}>
          The Element Extractor bookmarklet inspects any web page you visit and extracts all
          interactive elements — form fields, table columns, buttons, and links — outputting a
          structured JSON summary. Use it to reverse-engineer legacy apps, build selectors for
          automation, or document web interfaces quickly.
        </p>
      </div>
      <div className={styles.infoCard}>
        <h3 className={styles.infoCardTitle}>Install Bookmarklet</h3>
        <p className={styles.infoCardBody}>
          Drag the button below to your browser&apos;s bookmarks bar. Then visit any page and click
          it to run the extractor.
        </p>
        {/* eslint-disable-next-line react/jsx-no-script-url */}
        <a
          href={BOOKMARKLET_HREF}
          className={styles.bookmarkletLink}
          title="Drag to your bookmarks bar"
          draggable
        >
          🔍 NodeToolbox Extractor
        </a>
        <p className={styles.infoCardBody}>
          Note: The bookmarklet runs entirely in the browser — no data leaves your machine.
        </p>
      </div>
    </div>
  )
}

// ── Root component ──

/** Text Tools view — 6-tab utility belt for developers and testers. */
export default function TextToolsView() {
  const { state, actions } = useTextToolsState()

  function renderActiveTabContent() {
    switch (state.activeTab) {
      case 'smart-formatter':
        return (
          <SmartFormatterPanel
            inputText={state.smartFormatterInput}
            mode={state.smartFormatterMode}
            onInputChange={actions.setSmartFormatterInput}
            onModeChange={actions.setSmartFormatterMode}
            onClear={actions.clearSmartFormatter}
          />
        )
      case 'json':
        return (
          <JsonFormatterPanel
            inputText={state.jsonInput}
            indentMode={state.jsonIndentMode}
            onInputChange={actions.setJsonInput}
            onIndentModeChange={actions.setJsonIndentMode}
            onClear={actions.clearJson}
          />
        )
      case 'case':
        return (
          <CaseConverterPanel
            inputText={state.caseInput}
            onInputChange={actions.setCaseInput}
          />
        )
      case 'url':
        return (
          <UrlEncoderPanel
            inputText={state.urlInput}
            urlOperation={state.urlOperation}
            urlScope={state.urlScope}
            onInputChange={actions.setUrlInput}
            onOperationChange={actions.setUrlOperation}
            onScopeChange={actions.setUrlScope}
            onClear={actions.clearUrl}
          />
        )
      case 'base64':
        return (
          <Base64Panel
            inputText={state.base64Input}
            base64Operation={state.base64Operation}
            onInputChange={actions.setBase64Input}
            onOperationChange={actions.setBase64Operation}
            onClear={actions.clearBase64}
          />
        )
      case 'extractor':
        return <ElementExtractorPanel />
      default:
        return null
    }
  }

  return (
    <div className={styles.textToolsView}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div role="tablist" className={styles.tabList}>
        {TAB_OPTIONS.map((tabOption) => (
          <button
            key={tabOption.key}
            role="tab"
            aria-selected={state.activeTab === tabOption.key}
            className={`${styles.tabButton} ${state.activeTab === tabOption.key ? styles.activeTab : ''}`}
            onClick={() => actions.setActiveTab(tabOption.key)}
          >
            {tabOption.label}
          </button>
        ))}
      </div>

      {renderActiveTabContent()}
    </div>
  )
}
