// WikiMarkupEditor.tsx — Minimal core-formatting editor that emits Jira (Server/DC) wiki markup.
// The stored value is a wiki-markup string. A toolbar wraps the current textarea selection with
// the same tokens the pure `serializeWikiMarkup` serializer produces, keeping the wiki-markup
// format defined in one place (lib/wikiMarkup.ts) and unit-tested there.

import { useRef } from 'react';

import styles from '../JiraTemplateMaker.module.css';

interface WikiMarkupEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/** One toolbar action: how to transform the selected (or empty) text into wiki markup. */
interface ToolbarAction {
  label: string;
  /** Wraps/forms the selected text into its wiki-markup representation. */
  apply: (selectedText: string) => string;
}

const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  { label: 'Bold', apply: (text) => `*${text || 'bold'}*` },
  { label: 'Italic', apply: (text) => `_${text || 'italic'}_` },
  { label: 'Code', apply: (text) => `{{${text || 'code'}}}` },
  { label: 'H2', apply: (text) => `h2. ${text || 'Heading'}` },
  { label: 'Bullet', apply: (text) => `* ${text || 'item'}` },
  { label: 'Numbered', apply: (text) => `# ${text || 'item'}` },
  { label: 'Link', apply: (text) => `[${text || 'text'}|https://]` },
];

/** A textarea plus a wiki-markup formatting toolbar. */
export default function WikiMarkupEditor({ id, value, onChange }: WikiMarkupEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function applyAction(action: ToolbarAction): void {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(`${value}${action.apply('')}`);
      return;
    }
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectedText = value.slice(selectionStart, selectionEnd);
    const replacement = action.apply(selectedText);
    onChange(`${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`);
  }

  return (
    <div>
      <div className={styles.toolbar}>
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            className={styles.toolbarButton}
            key={action.label}
            onClick={() => applyAction(action)}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
      <textarea
        className={styles.textarea}
        id={id}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        ref={textareaRef}
        value={value}
      />
    </div>
  );
}
