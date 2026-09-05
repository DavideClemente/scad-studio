const STORAGE_KEY = 'scad-studio:autosave';

export function loadAutosave(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveAutosave(source: string) {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // Ignore quota / private-browsing errors - autosave is a convenience, not a guarantee.
  }
}

const OPEN_DESIGN_KEY = 'scad-studio:open-design';

/** Path of the design the editor was following, so a reload can pick it up again. */
export function loadOpenDesign(): string | null {
  try {
    return localStorage.getItem(OPEN_DESIGN_KEY);
  } catch {
    return null;
  }
}

export function saveOpenDesign(designPath: string | null) {
  try {
    if (designPath === null) localStorage.removeItem(OPEN_DESIGN_KEY);
    else localStorage.setItem(OPEN_DESIGN_KEY, designPath);
  } catch {
    // Same as the autosave: a convenience, not a guarantee.
  }
}

const EDITOR_DIRTY_KEY = 'scad-studio:editor-dirty';

/**
 * Whether the editor had gone past the followed design's file when the page was
 * last touched. A reload has to know this to tell "the file changed while I was
 * away" (take it) from "I edited this and did not save" (ask).
 *
 * A flag rather than a second copy of the text to compare against. That is what
 * this was at first, and it was wrong: the copy of the editor's text is written
 * on a debounce and the copy of the file's text was written the instant a change
 * arrived, so closing the page in between left the two disagreeing about a change
 * nobody had made, and every reload opened with a conflict to resolve. A flag can
 * be written on the same tick as the thing it describes, so it cannot drift.
 */
export function loadEditorDirty(): boolean {
  try {
    return localStorage.getItem(EDITOR_DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveEditorDirty(dirty: boolean) {
  try {
    if (dirty) localStorage.setItem(EDITOR_DIRTY_KEY, '1');
    else localStorage.removeItem(EDITOR_DIRTY_KEY);
  } catch {
    // Same as the autosave: a convenience, not a guarantee.
  }
}
