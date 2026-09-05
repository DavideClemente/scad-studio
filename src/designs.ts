/**
 * The browser half of the designs/ folder link (see vite/scadDesigns.ts).
 *
 * Everything here degrades to "there is no designs folder" when the endpoints are
 * not there, which is the case in a production build — the app still works, it
 * just has nothing on disk to follow.
 */

const LIST_URL = '/__scad/designs';
const FILE_URL = '/__scad/file';
const CHANGED_EVENT = 'scad:changed';

export type DesignChange = { path: string; text: string };

/** Paths of the .scad files in designs/, relative to that folder. */
export async function listDesigns(): Promise<string[]> {
  try {
    const response = await fetch(LIST_URL);
    if (!response.ok) return [];
    const files: unknown = await response.json();
    return Array.isArray(files) ? (files as string[]) : [];
  } catch {
    return [];
  }
}

export async function loadDesign(designPath: string): Promise<string> {
  const response = await fetch(`${FILE_URL}?path=${encodeURIComponent(designPath)}`);
  if (!response.ok) throw new Error(`Could not read ${designPath} (HTTP ${response.status}).`);
  return response.text();
}

/**
 * Calls back whenever a design changes on disk; returns a function that stops
 * listening. Does nothing at all outside the dev server, where `import.meta.hot`
 * is undefined and there is no channel to listen on.
 */
export function onDesignChanged(handler: (change: DesignChange) => void): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  hot.on(CHANGED_EVENT, handler);
  return () => hot.off(CHANGED_EVENT, handler);
}
