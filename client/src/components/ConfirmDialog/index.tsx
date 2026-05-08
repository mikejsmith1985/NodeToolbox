// index.tsx — In-app confirm dialog replacing window.confirm().
//
// Renders a centered modal with confirm and cancel actions inside the app shell.

import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  message: string;
  onConfirm(): void;
  onCancel(): void;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
}

/** ConfirmDialog keeps destructive confirmations inside the app instead of the browser chrome. */
export default function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDangerous = false,
}: ConfirmDialogProps) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <p className={styles.message}>{message}</p>
        <div className={styles.buttonRow}>
          <button className={styles.cancelButton} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button
            className={isDangerous ? styles.dangerButton : styles.confirmButton}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
