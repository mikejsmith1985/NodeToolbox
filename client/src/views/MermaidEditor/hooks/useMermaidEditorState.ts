// useMermaidEditorState.ts — State persistence for the Mermaid Editor view.
//
// The Mermaid Editor keeps the user's diagram text available across navigation,
// exposes starter templates, and stores render errors separately so the view can
// show friendly feedback without losing draft diagram work.

import { useCallback, useState } from 'react';

// ── Named constants — shared by the hook and tests. ────────────────────────

/** LocalStorage key retained from the legacy ToolBox Mermaid editor contract. */
export const MERMAID_EDITOR_STORAGE_KEY = 'tbxMermaidEditorState';

/** Flowchart starter template gives first-time users an immediately renderable diagram. */
const FLOWCHART_TEMPLATE_SOURCE = `flowchart LR
  Idea[Capture idea] --> Plan[Shape the plan]
  Plan --> Build[Build the solution]
  Build --> Ship[Ship with confidence]`;

/** Sequence template demonstrates the message format Mermaid users commonly need. */
const SEQUENCE_TEMPLATE_SOURCE = `sequenceDiagram
  participant User
  participant Toolbox
  User->>Toolbox: Open Mermaid Editor
  Toolbox-->>User: Render diagram preview`;

/** Class template helps users document relationships between TypeScript-friendly concepts. */
const CLASS_TEMPLATE_SOURCE = `classDiagram
  class Diagram {
    +string source
    +render()
  }
  class Template {
    +string name
  }
  Diagram --> Template`;

/** Gantt template mirrors the legacy editor's project-planning example category. */
const GANTT_TEMPLATE_SOURCE = `gantt
  title Delivery Plan
  dateFormat  YYYY-MM-DD
  section Build
  Port legacy view :active, taskOne, 2026-01-01, 2d
  Validate output :taskTwo, after taskOne, 1d`;

/** ER template gives data-modeling users a compact valid starting point. */
const ENTITY_RELATIONSHIP_TEMPLATE_SOURCE = `erDiagram
  USER ||--o{ DIAGRAM : creates
  DIAGRAM ||--o{ EXPORT : produces
  USER {
    string name
  }
  DIAGRAM {
    string source
  }`;

// ── Public types exposed by the hook. ──────────────────────────────────────

export interface MermaidEditorTemplate {
  id: string;
  label: string;
  description: string;
  source: string;
}

export interface MermaidEditorState {
  diagramSource: string;
  templates: MermaidEditorTemplate[];
  renderErrorMessage: string | null;
}

export interface MermaidEditorActions {
  setDiagramSource: (diagramSource: string) => void;
  applyTemplate: (templateId: string) => void;
  clearDiagramSource: () => void;
  setRenderErrorMessage: (renderErrorMessage: string | null) => void;
}

// ── Template catalogue. ────────────────────────────────────────────────────

const MERMAID_EDITOR_TEMPLATES: MermaidEditorTemplate[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    description: 'Shows a left-to-right process flow.',
    source: FLOWCHART_TEMPLATE_SOURCE,
  },
  {
    id: 'sequence',
    label: 'Sequence Diagram',
    description: 'Shows messages between participants.',
    source: SEQUENCE_TEMPLATE_SOURCE,
  },
  {
    id: 'class',
    label: 'Class Diagram',
    description: 'Shows classes and relationships.',
    source: CLASS_TEMPLATE_SOURCE,
  },
  {
    id: 'gantt',
    label: 'Gantt',
    description: 'Shows a simple delivery timeline.',
    source: GANTT_TEMPLATE_SOURCE,
  },
  {
    id: 'er',
    label: 'ER Diagram',
    description: 'Shows entities and their relationships.',
    source: ENTITY_RELATIONSHIP_TEMPLATE_SOURCE,
  },
];

// ── Internal helpers. ──────────────────────────────────────────────────────

function readSavedDiagramSource(): string | null {
  return window.localStorage.getItem(MERMAID_EDITOR_STORAGE_KEY);
}

function persistDiagramSource(diagramSource: string): void {
  window.localStorage.setItem(MERMAID_EDITOR_STORAGE_KEY, diagramSource);
}

function removePersistedDiagramSource(): void {
  window.localStorage.removeItem(MERMAID_EDITOR_STORAGE_KEY);
}

function resolveInitialDiagramSource(): string {
  return readSavedDiagramSource() ?? FLOWCHART_TEMPLATE_SOURCE;
}

// ── Hook. ──────────────────────────────────────────────────────────────────

/**
 * Owns Mermaid Editor state so rendering concerns stay isolated in the view.
 * It persists draft source immediately because diagram editing is often iterative
 * and users should not lose work when they navigate away.
 */
export function useMermaidEditorState(): MermaidEditorState & MermaidEditorActions {
  const [diagramSource, setDiagramSourceState] = useState<string>(resolveInitialDiagramSource);
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);

  const setDiagramSource = useCallback((nextDiagramSource: string) => {
    setDiagramSourceState(nextDiagramSource);
    persistDiagramSource(nextDiagramSource);
  }, []);

  const applyTemplate = useCallback((templateId: string) => {
    const selectedTemplate = MERMAID_EDITOR_TEMPLATES.find((availableTemplate) => availableTemplate.id === templateId);
    if (!selectedTemplate) {
      return;
    }
    setDiagramSourceState(selectedTemplate.source);
    persistDiagramSource(selectedTemplate.source);
    setRenderErrorMessage(null);
  }, []);

  const clearDiagramSource = useCallback(() => {
    setDiagramSourceState('');
    setRenderErrorMessage(null);
    removePersistedDiagramSource();
  }, []);

  return {
    diagramSource,
    templates: MERMAID_EDITOR_TEMPLATES,
    renderErrorMessage,
    setDiagramSource,
    applyTemplate,
    clearDiagramSource,
    setRenderErrorMessage,
  };
}
