// index.tsx — In-app prompt dialog replacing window.prompt().
//
// Renders a text input inside the app so password prompts stay in the product UI.

import { useState } from 'react';

import styles from './PromptDialog.module.css';

interface PromptDialogProps {
  message: string;
  inputLabel?: string;
  placeholder?: string;
  initialValue?: string;
  onConfirm(value: string): void;
  onCancel(): void;
  isPassword?: boolean;
}

/** PromptDialog collects a short text response without relying on the browser prompt window. */
export default function PromptDialog({
  message,
  inputLabel,
  placeholder,
  initialValue = '',
  onConfirm,
  onCancel,
  isPassword = false,
}: PromptDialogProps) {
  const [inputValue, setInputValue] = useState(initialValue);
  const hasInputValue = inputValue.trim() !== '';

  function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (hasInputValue) {
      onConfirm(inputValue);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <p className={styles.message}>{message}</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          {inputLabel && <label className={styles.label}>{inputLabel}</label>}
          <input
            autoFocus
            className={styles.input}
            onChange={(changeEvent) => setInputValue(changeEvent.target.value)}
            placeholder={placeholder}
            type={isPassword ? 'password' : 'text'}
            value={inputValue}
          />
          <div className={styles.buttonRow}>
            <button className={styles.cancelButton} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className={styles.confirmButton} disabled={!hasInputValue} type="submit">
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
