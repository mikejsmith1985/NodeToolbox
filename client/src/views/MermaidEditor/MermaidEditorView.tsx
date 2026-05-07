// MermaidEditorView.tsx — React view for editing and previewing Mermaid diagrams.
//
// The view ports the legacy ToolBox Mermaid Editor into a declarative split-pane
// workspace. The hook owns persisted source and template state while this file
// owns debounced rendering, SVG copy, and SVG download interactions.

import { useCallback, useEffect, useRef, useState } from 'react';

import mermaid from 'mermaid';

import { useMermaidEditorState } from './hooks/useMermaidEditorState.ts';
import styles from './MermaidEditorView.module.css';

const VIEW_TITLE = 'Mermaid Editor';
const VIEW_SUBTITLE = 'Draft Mermaid diagrams, preview the rendered SVG, and export the result without leaving NodeToolbox.';
const RENDER_DEBOUNCE_MS = 300;
const RENDER_ID_PREFIX = 'mermaid-editor';
const SVG_MIME_TYPE = 'image/svg+xml;charset=utf-8';
const SVG_DOWNLOAD_FILE_NAME = 'diagram.svg';
const TEMPLATE_EMPTY_VALUE = '';
const EMPTY_PREVIEW_MESSAGE = 'Enter Mermaid source to render a preview.';
const RENDERING_MESSAGE = 'Rendering…';
const READY_MESSAGE = 'Ready';
const RENDERED_MESSAGE = '✓ Rendered';
const RENDER_FAILED_MESSAGE = '⚠ Render failed';
const CLIPBOARD_UNAVAILABLE_MESSAGE = 'Clipboard copy is not available in this browser.';
const CLIPBOARD_COPY_FAILED_MESSAGE = 'Unable to copy SVG to the clipboard.';

mermaid.initialize({ startOnLoad: false, theme: 'default' });

function extractErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof Error) {
    return caughtError.message;
  }
  return 'Mermaid could not render this diagram.';
}

function downloadSvgMarkup(svgMarkup: string): void {
  const svgBlob = new Blob([svgMarkup], { type: SVG_MIME_TYPE });
  const downloadUrl = URL.createObjectURL(svgBlob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = downloadUrl;
  downloadAnchor.download = SVG_DOWNLOAD_FILE_NAME;
  downloadAnchor.click();
  URL.revokeObjectURL(downloadUrl);
}

function buildRenderStatus(isRendering: boolean, hasRenderedSvg: boolean, renderErrorMessage: string | null): string {
  if (isRendering) {
    return RENDERING_MESSAGE;
  }
  if (renderErrorMessage) {
    return RENDER_FAILED_MESSAGE;
  }
  if (hasRenderedSvg) {
    return RENDERED_MESSAGE;
  }
  return READY_MESSAGE;
}

/** Renders the Mermaid Editor page and wires toolbar actions to browser APIs. */
export default function MermaidEditorView() {
  const {
    diagramSource,
    templates,
    renderErrorMessage,
    setDiagramSource,
    applyTemplate,
    clearDiagramSource,
    setRenderErrorMessage,
  } = useMermaidEditorState();
  const [renderedSvg, setRenderedSvg] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const renderSequenceRef = useRef<number>(0);

  const renderDiagramSource = useCallback(
    async (sourceToRender: string, renderSequence: number) => {
      try {
        const renderIdentifier = `${RENDER_ID_PREFIX}-${renderSequence}`;
        const renderResponse = await mermaid.render(renderIdentifier, sourceToRender);
        if (renderSequenceRef.current !== renderSequence) return;
        setRenderedSvg(renderResponse.svg);
        setRenderErrorMessage(null);
      } catch (caughtError: unknown) {
        if (renderSequenceRef.current !== renderSequence) return;
        setRenderedSvg('');
        setRenderErrorMessage(extractErrorMessage(caughtError));
      } finally {
        if (renderSequenceRef.current === renderSequence) {
          setIsRendering(false);
        }
      }
    },
    [setRenderErrorMessage],
  );

  useEffect(() => {
    const trimmedDiagramSource = diagramSource.trim();
    if (!trimmedDiagramSource) {
      return undefined;
    }

    renderSequenceRef.current += 1;
    const renderSequence = renderSequenceRef.current;
    const renderTimer = window.setTimeout(() => {
      setIsRendering(true);
      void renderDiagramSource(trimmedDiagramSource, renderSequence);
    }, RENDER_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(renderTimer);
    };
  }, [diagramSource, renderDiagramSource]);

  const updateDiagramSource = useCallback(
    (nextDiagramSource: string) => {
      setDiagramSource(nextDiagramSource);
      if (nextDiagramSource.trim()) {
        return;
      }
      renderSequenceRef.current += 1;
      setRenderedSvg('');
      setIsRendering(false);
      setRenderErrorMessage(null);
    },
    [setDiagramSource, setRenderErrorMessage],
  );

  const clearEditorSource = useCallback(() => {
    clearDiagramSource();
    renderSequenceRef.current += 1;
    setRenderedSvg('');
    setIsRendering(false);
  }, [clearDiagramSource]);

  const copyRenderedSvg = useCallback(async () => {
    if (!renderedSvg) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setRenderErrorMessage(CLIPBOARD_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      await navigator.clipboard.writeText(renderedSvg);
    } catch (caughtError: unknown) {
      setRenderErrorMessage(`${CLIPBOARD_COPY_FAILED_MESSAGE} ${extractErrorMessage(caughtError)}`);
    }
  }, [renderedSvg, setRenderErrorMessage]);

  const downloadRenderedSvg = useCallback(() => {
    if (!renderedSvg) {
      return;
    }
    downloadSvgMarkup(renderedSvg);
  }, [renderedSvg]);

  const hasRenderedSvg = renderedSvg.length > 0;
  const canExportSvg = hasRenderedSvg && !isRendering;
  const renderStatusMessage = buildRenderStatus(isRendering, hasRenderedSvg, renderErrorMessage);

  return (
    <section className={styles.mermaidEditorView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.toolbar} aria-label="Mermaid editor toolbar">
        <select
          className={styles.templateSelect}
          aria-label="Templates"
          value={TEMPLATE_EMPTY_VALUE}
          onChange={(changeEvent) => applyTemplate(changeEvent.target.value)}
        >
          <option value={TEMPLATE_EMPTY_VALUE}>Templates</option>
          {templates.map((availableTemplate) => (
            <option key={availableTemplate.id} value={availableTemplate.id}>
              {availableTemplate.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.buttonPrimary} disabled={!canExportSvg} onClick={copyRenderedSvg}>
          Copy SVG
        </button>
        <button type="button" className={styles.button} disabled={!canExportSvg} onClick={downloadRenderedSvg}>
          Download SVG
        </button>
        <button type="button" className={styles.button} onClick={clearEditorSource}>
          Clear
        </button>
      </div>

      <div className={styles.editorGrid}>
        <label className={styles.pane}>
          <span className={styles.paneHeader}>Source</span>
          <textarea
            className={styles.sourceTextarea}
            aria-label="Mermaid diagram source"
            spellCheck={false}
            value={diagramSource}
            onChange={(changeEvent) => updateDiagramSource(changeEvent.target.value)}
          />
        </label>

        <section className={styles.previewPane} aria-label="Rendered Mermaid preview">
          <div className={styles.paneHeader}>
            <span>Preview</span>
            <span aria-live="polite">{renderStatusMessage}</span>
          </div>
          <div className={styles.previewViewport}>
            {hasRenderedSvg ? (
              <div className={styles.renderedSvg} dangerouslySetInnerHTML={{ __html: renderedSvg }} />
            ) : (
              <div className={styles.emptyState}>{EMPTY_PREVIEW_MESSAGE}</div>
            )}
          </div>
        </section>
      </div>

      {renderErrorMessage ? (
        <p className={styles.errorPanel} role="alert">
          {renderErrorMessage}
        </p>
      ) : (
        <p className={styles.statusPanel} aria-live="polite">
          {renderStatusMessage}
        </p>
      )}
    </section>
  );
}
