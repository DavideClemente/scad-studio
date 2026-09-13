import { createContext, useContext } from 'react';

/**
 * Asking the user something, without handing the question to the browser.
 *
 * `confirm()` and `prompt()` work, but they announce themselves as
 * "localhost:5173 says", cannot be styled, and stop the page dead while they are
 * up. They read as something the browser is asking, not something the app is.
 */

export type ConfirmOptions = {
  title: string;
  /** A line under the title, for what the user should know before answering. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colours the confirm button as a destructive action. */
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: string;
  label: string;
  value?: string;
  confirmLabel?: string;
  /**
   * Checked on every keystroke and again on submit; a returned string is shown
   * as the reason and blocks the submit. This is where a caller says what names
   * it will not accept — the dialog itself only knows that empty is not a name.
   */
  validate?: (value: string) => string | null;
};

export type DialogApi = {
  /** Resolves true if the user confirmed, false if they cancelled or dismissed. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves the trimmed text, or null if the user cancelled or dismissed. */
  promptText: (options: PromptOptions) => Promise<string | null>;
};

export const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialog must be used inside a DialogProvider.');
  return api;
}
