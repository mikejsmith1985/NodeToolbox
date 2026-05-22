// ToastContext.ts — Shared toast context and hook for screens that need to trigger in-app notifications.

import { createContext, useContext } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastContextValue {
  showToast(message: string, type?: ToastType): void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/** useToast exposes the shared toast dispatcher for child components inside ToastProvider. */
export function useToast(): ToastContextValue {
  const toastContext = useContext(ToastContext);
  if (!toastContext) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return toastContext;
}
