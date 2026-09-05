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

const DISK_TEXT_KEY = 'scad-studio:disk-text';

/**
 * What the followed design said on disk when the editor last agreed with it.
 * Without this, a reload cannot tell "the file changed while I was away" from
 * "I edited this and did not save", and has to ask about both.
 */
export function loadDiskText(): string | null {
  try {
    return localStorage.getItem(DISK_TEXT_KEY);
  } catch {
    return null;
  }
}

export function saveDiskText(text: string | null) {
  try {
    if (text === null) localStorage.removeItem(DISK_TEXT_KEY);
    else localStorage.setItem(DISK_TEXT_KEY, text);
  } catch {
    // Same as the autosave: a convenience, not a guarantee.
  }
}
