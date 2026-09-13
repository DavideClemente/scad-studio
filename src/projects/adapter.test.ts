import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from './adapter';
import { cloudApiUrl } from './config';

/**
 * Which adapter a build gets, and whether it says so. A published image that
 * quietly came out configured would send every self-hoster's saves to a server
 * they never chose, so the unconfigured case is the one that matters most.
 */

type ConfigWindow = { __SCAD_STUDIO_CONFIG__?: { cloudApiUrl?: string } };

function setRuntimeConfig(config: ConfigWindow['__SCAD_STUDIO_CONFIG__']) {
  (globalThis as { window?: ConfigWindow }).window = { __SCAD_STUDIO_CONFIG__: config };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (globalThis as { window?: ConfigWindow }).window;
});

describe('backend configuration', () => {
  it('is local and silent when nothing is configured', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('VITE_CLOUD_API_URL', '');
    expect(cloudApiUrl()).toBeNull();
    expect(createAdapter().kind).toBe('local');
    expect(info).not.toHaveBeenCalled();
  });

  it('reads the build-time variable, and says it has no cloud adapter to use it with', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('VITE_CLOUD_API_URL', 'https://example.invalid');
    expect(cloudApiUrl()).toBe('https://example.invalid');
    // Still local until Phase 3 exists: configured is not the same as usable.
    expect(createAdapter().kind).toBe('local');
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toMatch(/cloud API is configured/);
  });

  it('prefers the runtime setting, so one image can be pointed at a backend by its host', () => {
    vi.stubEnv('VITE_CLOUD_API_URL', 'https://build.invalid');
    setRuntimeConfig({ cloudApiUrl: 'https://runtime.invalid' });
    expect(cloudApiUrl()).toBe('https://runtime.invalid');
  });

  it('treats blank values as unset and drops trailing slashes', () => {
    vi.stubEnv('VITE_CLOUD_API_URL', '   ');
    setRuntimeConfig({ cloudApiUrl: '' });
    expect(cloudApiUrl()).toBeNull();
    setRuntimeConfig({ cloudApiUrl: ' https://example.invalid/// ' });
    expect(cloudApiUrl()).toBe('https://example.invalid');
  });
});
