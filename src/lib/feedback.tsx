import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from '../components/overlay.tsx';

/* Toasts: a short line at the bottom that confirms what just happened (rendered by <Toaster />). */

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'critical' | 'info';
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let nextId = 1;

export function toast(text: string, tone: Toast['tone'] = 'good') {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 3200);
}

export const subscribeToasts = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const currentToasts = () => toasts;

/* Confirm: a real dialog instead of the browser's grey box. */

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
}

/** Asks and resolves to true when confirmed. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      <ConfirmDialog
        options={options}
        onClose={(ok) => {
          root.unmount();
          host.remove();
          resolve(ok);
        }}
      />,
    );
  });
}
