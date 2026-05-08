// ToastProvider.tsx — Context-based in-app toast notification system.
//
// Replaces browser alerts and other native notifications with shared app toasts.

import { createContext, useCallback, useContext, useRef, useState } from 'react';

import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast(message: string, type?: ToastType): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_DURATION_MS = 4_000;

/** ToastProvider renders a shared toast stack so any screen can show in-app notifications. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toastMessages, setToastMessages] = useState<ToastMessage[]>([]);
  const nextToastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    nextToastIdRef.current += 1;
    const toastId = `toast-${nextToastIdRef.current}`;
    setToastMessages((previousToastMessages) => [
      ...previousToastMessages,
      { id: toastId, message, type },
    ]);

    window.setTimeout(() => {
      setToastMessages((previousToastMessages) =>
        previousToastMessages.filter((toastMessage) => toastMessage.id !== toastId),
      );
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={styles.toastContainer} aria-live="polite" aria-atomic="true">
        {toastMessages.map((toastMessage) => (
          <div key={toastMessage.id} className={`${styles.toast} ${styles[toastMessage.type]}`}>
            {toastMessage.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** useToast exposes the shared toast dispatcher for child components inside ToastProvider. */
export function useToast(): ToastContextValue {
  const toastContext = useContext(ToastContext);
  if (!toastContext) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return toastContext;
}
