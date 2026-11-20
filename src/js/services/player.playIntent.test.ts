// Tests generated using AI

/**
 * Play-intent clock used by useMediaControls to ignore the spurious Media
 * Session pause the Tesla sends right after playback restarts.
 */

describe('player msSincePlayIntent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('is Infinity before any play intent', async () => {
    const playerX = await import('./player');
    expect(playerX.msSincePlayIntent()).toBe(Infinity);
  });

  test('resume() starts the clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T06:00:00Z'));
    const playerX = await import('./player');
    playerX.resume();
    expect(playerX.msSincePlayIntent()).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(playerX.msSincePlayIntent()).toBe(1500);
  });
});
