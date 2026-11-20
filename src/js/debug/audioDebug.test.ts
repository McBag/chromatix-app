// Tests generated using AI

/**
 * The debug overlay is opt-in: nothing may be hooked or shown during normal use.
 */

const load = async (search: string) => {
  window.history.replaceState(null, '', `/${search}`);
  vi.resetModules();
  return import('./audioDebug');
};

const origCreateElement = document.createElement;

describe('audioDebug opt-in', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.getElementById('chromatix-debug-overlay')?.remove();
    document.createElement = origCreateElement;
  });

  afterAll(() => {
    document.createElement = origCreateElement;
    window.history.replaceState(null, '', '/');
  });

  test('is off by default and hooks nothing', async () => {
    const mod = await load('');
    expect(mod.isDebugEnabled()).toBe(false);
    expect(document.getElementById('chromatix-debug-overlay')).toBeNull();
    expect(document.createElement).toBe(origCreateElement);
  });

  test('?debug=1 enables, remembers the flag and shows the version', async () => {
    vi.stubEnv('VITE_VERSION', '9.9.9');
    const mod = await load('?debug=1');
    expect(mod.isDebugEnabled()).toBe(true);
    expect(localStorage.getItem('chromatix_debug')).toBe('1');
    const overlay = document.getElementById('chromatix-debug-overlay');
    expect(overlay?.textContent).toContain('Chromatix DEBUG 9.9.9');
    vi.unstubAllEnvs();
  });

  test('stays on after reload without the parameter, ?debug=0 turns it off', async () => {
    localStorage.setItem('chromatix_debug', '1');
    expect((await load('')).isDebugEnabled()).toBe(true);
    document.getElementById('chromatix-debug-overlay')?.remove();
    expect((await load('?debug=0')).isDebugEnabled()).toBe(false);
    expect(localStorage.getItem('chromatix_debug')).toBeNull();
  });

  test('× button clears the flag and removes the overlay', async () => {
    const mod = await load('?debug=1');
    const close = Array.from(document.querySelectorAll('#chromatix-debug-overlay button')).find(
      (b) => b.textContent === '×'
    ) as HTMLButtonElement;
    close.click();
    expect(mod.isDebugEnabled()).toBe(false);
    expect(localStorage.getItem('chromatix_debug')).toBeNull();
    expect(document.getElementById('chromatix-debug-overlay')).toBeNull();
  });
});
