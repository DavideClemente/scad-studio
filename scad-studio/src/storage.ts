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
