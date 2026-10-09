import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { currentToasts, subscribeToasts, type ConfirmOptions } from '../lib/feedback.tsx';
import { Button, StatusIcon } from './ui.tsx';

/* ---------- Toasts: a short line at the bottom that confirms what just happened. ---------- */

/** Mounted once in App: shows the toasts above the tab bar. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, currentToasts);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),12px)+76px)] z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div key={t.id} className="toast-in flex max-w-sm items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-plane shadow-pop">
          <StatusIcon level={t.tone === 'info' ? 'info' : t.tone} className="size-4" />
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- Confirm: a real dialog instead of the browser's grey box. ---------- */

export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = (ok: boolean) => {
    setLeaving(true);
    setTimeout(() => onClose(ok), 160);
  };
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
      onClick={(e) => e.target === ref.current && close(false)}
      className={`sheet m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[2px] sm:m-auto sm:max-w-sm ${leaving ? 'sheet-out' : ''}`}
      aria-labelledby="confirm-title"
    >
      <div className="rounded-t-[28px] bg-surface p-6 pb-[max(env(safe-area-inset-bottom),24px)] shadow-pop sm:rounded-[24px] sm:pb-6">
        <h2 id="confirm-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">
          {options.title}
        </h2>
        {options.body && <p className="mt-2 text-sm leading-relaxed text-ink-2">{options.body}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="quiet" className="h-11 sm:h-10" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            className={`h-11 sm:h-10 ${options.danger ? '!bg-critical !text-white hover:!bg-critical/90' : ''}`}
            onClick={() => close(true)}
            autoFocus
          >
            {options.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
