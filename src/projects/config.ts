/**
 * Where the app looks to find out whether it has a backend to talk to.
 *
 * Two places, in order. A global on `window` is read first, so one built image can
 * be pointed at a backend by the server that hosts it — the published image stays
 * unconfigured, and self-hosters pulling it get the local-only build without
 * having to build anything themselves. A Vite env var is read second, which is
 * what a local `.env` or a build-time secret sets.
 *
 * Neither being set is the normal case, and means local-only.
 */

declare global {
  interface Window {
    __SCAD_STUDIO_CONFIG__?: { cloudApiUrl?: string };
  }
}

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim().replace(/\/+$/, '');
  return url.length > 0 ? url : null;
}

/** The backend's base URL, or null when there is none — which is the default. */
export function cloudApiUrl(): string | null {
  const runtime = trimmed(globalThis.window?.__SCAD_STUDIO_CONFIG__?.cloudApiUrl);
  if (runtime) return runtime;
  return trimmed(import.meta.env.VITE_CLOUD_API_URL);
}
