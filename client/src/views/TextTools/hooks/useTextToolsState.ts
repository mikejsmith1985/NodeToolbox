// useTextToolsState.ts — State management hook for the Text Tools view.
//
// Manages tab selection, per-tab input fields, and persists the active tab
// to the shared settings store so the selection survives navigation.

import { useState } from 'react'

import { useSettingsStore } from '../../../store/settingsStore'
import type {
  Base64Operation,
  JsonIndentMode,
  SmartFormatterMode,
  UrlOperation,
  UrlScope,
} from '../utils/textTransformUtils.ts'

// ── Type definitions ──

/** All available tab identifiers in the Text Tools view. */
export type TextToolsTab =
  | 'smart-formatter'
  | 'json'
  | 'case'
  | 'url'
  | 'base64'
  | 'extractor'

/** All transient state fields managed by this hook. */
export interface TextToolsState {
  activeTab: TextToolsTab
  smartFormatterInput: string
  smartFormatterMode: SmartFormatterMode
  jsonInput: string
  jsonIndentMode: JsonIndentMode
  caseInput: string
  urlInput: string
  urlOperation: UrlOperation
  urlScope: UrlScope
  base64Input: string
  base64Operation: Base64Operation
}

/** All action callbacks returned by this hook. */
export interface TextToolsActions {
  setActiveTab(tab: TextToolsTab): void
  setSmartFormatterInput(value: string): void
  setSmartFormatterMode(mode: SmartFormatterMode): void
  clearSmartFormatter(): void
  setJsonInput(value: string): void
  setJsonIndentMode(mode: JsonIndentMode): void
  clearJson(): void
  setCaseInput(value: string): void
  setUrlInput(value: string): void
  setUrlOperation(op: UrlOperation): void
  setUrlScope(scope: UrlScope): void
  clearUrl(): void
  setBase64Input(value: string): void
  setBase64Operation(op: Base64Operation): void
  clearBase64(): void
}

// ── Named constants ──

const VALID_TAB_VALUES: readonly TextToolsTab[] = [
  'smart-formatter',
  'json',
  'case',
  'url',
  'base64',
  'extractor',
]

const DEFAULT_TAB: TextToolsTab = 'case'
const EMPTY_STRING = ''

// ── Helper ──

/** Returns the stored tab value if it is a valid TextToolsTab, otherwise the default. */
function resolveInitialTab(storedTab: string): TextToolsTab {
  return (VALID_TAB_VALUES as string[]).includes(storedTab)
    ? (storedTab as TextToolsTab)
    : DEFAULT_TAB
}

// ── Hook ──

/** Provides all transient UI state and action callbacks for the Text Tools view. */
export function useTextToolsState(): { state: TextToolsState; actions: TextToolsActions } {
  const [activeTab, setActiveTabLocal] = useState<TextToolsTab>(() =>
    resolveInitialTab(useSettingsStore.getState().textToolsTab),
  )
  const [smartFormatterInput, setSmartFormatterInput] = useState(EMPTY_STRING)
  const [smartFormatterMode, setSmartFormatterMode] = useState<SmartFormatterMode>('markdown')
  const [jsonInput, setJsonInput] = useState(EMPTY_STRING)
  const [jsonIndentMode, setJsonIndentMode] = useState<JsonIndentMode>(2)
  const [caseInput, setCaseInput] = useState(EMPTY_STRING)
  const [urlInput, setUrlInput] = useState(EMPTY_STRING)
  const [urlOperation, setUrlOperation] = useState<UrlOperation>('encode')
  const [urlScope, setUrlScope] = useState<UrlScope>('component')
  const [base64Input, setBase64Input] = useState(EMPTY_STRING)
  const [base64Operation, setBase64Operation] = useState<Base64Operation>('encode')

  const state: TextToolsState = {
    activeTab,
    smartFormatterInput,
    smartFormatterMode,
    jsonInput,
    jsonIndentMode,
    caseInput,
    urlInput,
    urlOperation,
    urlScope,
    base64Input,
    base64Operation,
  }

  const actions: TextToolsActions = {
    setActiveTab(tab) {
      // Persist the selection so it survives navigation to other routes.
      useSettingsStore.getState().setTextToolsTab(tab)
      setActiveTabLocal(tab)
    },
    setSmartFormatterInput,
    setSmartFormatterMode,
    clearSmartFormatter: () => setSmartFormatterInput(EMPTY_STRING),
    setJsonInput,
    setJsonIndentMode,
    clearJson: () => setJsonInput(EMPTY_STRING),
    setCaseInput,
    setUrlInput,
    setUrlOperation,
    setUrlScope,
    clearUrl: () => setUrlInput(EMPTY_STRING),
    setBase64Input,
    setBase64Operation,
    clearBase64: () => setBase64Input(EMPTY_STRING),
  }

  return { state, actions }
}
