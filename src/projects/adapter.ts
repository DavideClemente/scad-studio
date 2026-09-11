import { cloudApiUrl } from './config';
import { createLocalAdapter } from './localAdapter';
import type { StorageAdapter } from './types';

/**
 * Picks the adapter this build talks to. Local unless a backend is configured;
 * the cloud adapter that reads the same configuration is not written yet, so for
 * now a configured backend is noted and ignored rather than half-used.
 */
export function createAdapter(): StorageAdapter {
  const apiUrl = cloudApiUrl();
  if (apiUrl) {
    console.info('[scad-studio] A cloud API is configured, but this build has no cloud adapter yet; using local storage.');
  }
  return createLocalAdapter();
}
