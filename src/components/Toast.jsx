import React, { useEffect } from 'react';

/**
 * ToastContainer renders floating animated toast pills with auto-dismiss timers.
 * Accessible with role="region" and aria-live="polite".
 */
export function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration || 3500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const icon =
    toast.type === 'success' ? '✓' :
    toast.type === 'error' ? '✕' :
    toast.type === 'warning' ? '⚠' : 'ℹ';

  return (
    <div className={`toast-pill toast-${toast.type || 'info'}`} role="status">
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close-btn"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

