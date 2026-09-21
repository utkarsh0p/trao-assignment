'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import { AlertIcon, CheckIcon, XIcon } from './icons';

const ToastContext = createContext(null);

const TONES = {
  success: { className: 'bg-success-subtle text-success', Icon: CheckIcon },
  error: { className: 'bg-danger-subtle text-danger', Icon: AlertIcon },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (message, { tone = 'success', duration = 5000 } = {}) => {
      const id = ++nextId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      toast,
      success: (message, options) => toast(message, { ...options, tone: 'success' }),
      error: (message, options) => toast(message, { ...options, tone: 'error' }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Polite, not assertive: a saved edit should not interrupt a screen reader mid-sentence. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map(({ id, message, tone }) => {
          const { className, Icon } = TONES[tone] || TONES.success;
          return (
            <div
              key={id}
              className={cx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border p-4 shadow-lg',
                className,
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-text">{message}</p>
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="Dismiss"
                className="rounded-lg text-text-muted transition-colors duration-150 hover:text-text"
              >
                <XIcon />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
