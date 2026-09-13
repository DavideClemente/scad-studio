import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DialogContext } from './dialogContext';
import type { ConfirmOptions, DialogApi, PromptOptions } from './dialogContext';

type Request =
  | ({ kind: 'confirm'; resolve: (answer: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (answer: string | null) => void } & PromptOptions);

/**
 * The one dialog the app puts up, and the promise-shaped way to ask for it.
 *
 * Only one question is ever on screen: a second `confirm` or `promptText` while
 * one is open answers the first as a cancel rather than leaving a promise nobody
 * will ever settle.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Whatever had the keyboard before the dialog took it, so it can be given back.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Kept in step from an effect rather than at render time: `open` reads it from
  // an event handler, by which point the effect has always run.
  const requestRef = useRef<Request | null>(null);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const close = useCallback(() => {
    setRequest(null);
    setError(null);
    setValue('');
  }, []);

  const open = useCallback((next: Request) => {
    const pending = requestRef.current;
    if (pending) {
      if (pending.kind === 'confirm') pending.resolve(false);
      else pending.resolve(null);
    }
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setError(null);
    setValue(next.kind === 'prompt' ? (next.value ?? '') : '');
    setRequest(next);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => open({ kind: 'confirm', resolve, ...options })),
      promptText: (options) =>
        new Promise<string | null>((resolve) => open({ kind: 'prompt', resolve, ...options })),
    }),
    [open],
  );

  const cancel = useCallback(() => {
    if (!request) return;
    if (request.kind === 'confirm') request.resolve(false);
    else request.resolve(null);
    close();
  }, [request, close]);

  const submit = useCallback(() => {
    if (!request) return;
    if (request.kind === 'confirm') {
      request.resolve(true);
      close();
      return;
    }
    const answer = value.trim();
    // The dialog knows only that a name has to be something; anything more
    // particular is the caller's rule, and comes back as the reason to show.
    if (!answer) {
      setError('Give it a name first.');
      inputRef.current?.focus();
      return;
    }
    const reason = request.validate?.(answer) ?? null;
    if (reason) {
      setError(reason);
      inputRef.current?.focus();
      return;
    }
    request.resolve(answer);
    close();
  }, [request, value, close]);

  useEffect(() => {
    if (!request) {
      returnFocusRef.current?.focus?.();
      returnFocusRef.current = null;
      return;
    }
    // The dialog is the only thing being asked about, so it takes the keyboard.
    if (request.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    // Capture, so the editor underneath never sees the key first.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [request, cancel]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request && (
        <div
          className="modal-backdrop"
          // Only a press that lands on the backdrop itself dismisses. Comparing
          // the target against this element is what makes that true no matter
          // what the dialog is made of, where stopping the press inside it is
          // one forgotten handler away from a dialog that cannot be dismissed.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancel();
          }}
        >
          <form
            className="modal modal-ask"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <h2 className="modal-title" id="dialog-title">
              {request.title}
            </h2>
            {request.message && <p className="modal-message">{request.message}</p>}

            {request.kind === 'prompt' && (
              <label className="field">
                <span className="field-label">{request.label}</span>
                <input
                  ref={inputRef}
                  className="field-input"
                  value={value}
                  aria-invalid={error != null}
                  aria-describedby={error ? 'dialog-error' : undefined}
                  onChange={(event) => {
                    setValue(event.target.value);
                    const next = event.target.value.trim();
                    // Re-check while typing, but only to clear a reason already
                    // shown: complaining about a name half-typed is nagging.
                    if (error) setError(next ? (request.validate?.(next) ?? null) : null);
                  }}
                />
              </label>
            )}

            {error && (
              <p className="modal-error" id="dialog-error" role="alert">
                {error}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={cancel}>
                {request.kind === 'confirm' ? (request.cancelLabel ?? 'Cancel') : 'Cancel'}
              </button>
              <button
                type="submit"
                ref={confirmRef}
                className={`btn ${request.kind === 'confirm' && request.danger ? 'btn-danger' : 'btn-primary'}`}
              >
                {request.confirmLabel ?? (request.kind === 'confirm' ? 'OK' : 'Save')}
              </button>
            </div>
          </form>
        </div>
      )}
    </DialogContext.Provider>
  );
}
