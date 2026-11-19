// Tests generated using AI

/**
 * Player Service Test Suite
 *
 * Validates the single audio element player.
 * Each test reimports the module fresh so module-level state is fully zeroed.
 *
 * Mock audio elements are captured at createElement time so tests can inspect
 * their state (src, currentTime, volume, paused) directly.
 */

import { MockHTMLAudioElement } from '../../../__mocks__/HTMLAudioElement';

// ======================================================================
// HELPERS
// ======================================================================

/**
 * Reimports player.native with fresh module state.
 * Must be called inside beforeEach after vi.resetModules().
 */
async function freshPlayer() {
  const mod = await import('./player.native');
  return mod;
}

type Player = Awaited<ReturnType<typeof freshPlayer>>;

// Captured mock elements — reset alongside the module.
let createdElements: MockHTMLAudioElement[] = [];

// ======================================================================
// GLOBAL SETUP
// ======================================================================

const originalCreateElement = document.createElement.bind(document);

global.document.createElement = (tagName: string) => {
  if (tagName.toLowerCase() === 'audio') {
    const el = new MockHTMLAudioElement();
    createdElements.push(el);
    return el as any;
  }
  return originalCreateElement(tagName);
};

global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0)) as unknown as typeof requestAnimationFrame;

// ======================================================================
// TESTS
// ======================================================================

describe('Player Service', () => {
  let player: Player;

  const mockCallbacks = {
    onLoadStart: vi.fn(),
    onCanPlay: vi.fn(),
    onEnded: vi.fn(),
    onError: vi.fn(),
  };

  const defaultInit = () =>
    player.init({
      volumeLevel: 75,
      volumeMuted: false,
      ...mockCallbacks,
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    createdElements = [];
    player = await freshPlayer();
  });

  // Convenience accessor — after init(), the single player element is at index 0.
  const elementA = () => createdElements[0];

  // ======================================================================
  // INITIALISATION
  // ======================================================================

  describe('Initialisation', () => {
    test('creates one audio element on init', () => {
      defaultInit();
      expect(createdElements).toHaveLength(1);
    });

    test('sets volume correctly on init (unmuted)', () => {
      player.init({ volumeLevel: 60, volumeMuted: false, ...mockCallbacks });
      expect(elementA().volume).toBe(0.6);
    });

    test('sets volume to 0 on init when muted', () => {
      player.init({ volumeLevel: 80, volumeMuted: true, ...mockCallbacks });
      expect(elementA().volume).toBe(0);
    });

    test('does not create new elements on a second init call', () => {
      defaultInit();
      defaultInit();
      expect(createdElements).toHaveLength(1);
    });

    test('registers loadstart, canplay, ended, and error listeners', () => {
      defaultInit();
      // Tesla player advances via setTrackEndedCallback, not init onEnded.
      player.setTrackEndedCallback(mockCallbacks.onEnded);

      (elementA() as any).mockTriggerEvent('loadstart');
      expect(mockCallbacks.onLoadStart).toHaveBeenCalledTimes(1);

      (elementA() as any).mockTriggerEvent('canplay');
      expect(mockCallbacks.onCanPlay).toHaveBeenCalledTimes(1);

      (elementA() as any).mockTriggerEvent('ended');
      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(1);

      (elementA() as any).mockTriggerError({});
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
    });

    test('returns 0 for progress before init', () => {
      expect(player.getCurrentProgress()).toBe(0);
    });
  });

  // ======================================================================
  // TRACK LOADING
  // ======================================================================

  describe('Track Loading', () => {
    beforeEach(() => defaultInit());

    test('sets src on the active element', () => {
      player.loadTrack('http://example.com/track1.mp3');
      expect(elementA().src).toBe('http://example.com/track1.mp3');
    });

    test('starts playback by default', async () => {
      player.loadTrack('http://example.com/track1.mp3');
      // play() is async in the mock; give the micro-task queue a tick
      await Promise.resolve();
      expect(elementA().paused).toBe(false);
    });

    test('does not play when play=false', async () => {
      player.loadTrack('http://example.com/track1.mp3', 0, false);
      await Promise.resolve();
      expect(elementA().paused).toBe(true);
    });

    test('seeks to the correct position when progress is provided', () => {
      player.loadTrack('http://example.com/track1.mp3', 30000);
      // 30 000 ms → 30 s
      expect(elementA().currentTime).toBe(30);
    });

    test('does not seek when progress is 0', () => {
      player.loadTrack('http://example.com/track1.mp3', 0);
      expect(elementA().currentTime).toBe(0);
    });
  });

  // ======================================================================
  // UNLOAD
  // ======================================================================

  describe('Unload', () => {
    test('clears src on the player element', () => {
      defaultInit();
      player.loadTrack('http://example.com/track1.mp3');
      player.unload();
      expect(elementA().src).toBe('');
    });

    test('pauses the player element', async () => {
      defaultInit();
      player.loadTrack('http://example.com/track1.mp3');
      await Promise.resolve();
      player.unload();
      expect(elementA().paused).toBe(true);
    });

    test('can be called before init without throwing', () => {
      expect(() => player.unload()).not.toThrow();
    });

    test('is a no-op before loadTrack() — does not clear src or pause', () => {
      // needsReinit=true until the first loadTrack(); unload() skips idle players.
      defaultInit();
      player.unload();
      // Element was never given a src, so it should remain at its initial state.
      expect(elementA().src).toBe('');
      expect(elementA().paused).toBe(true);
    });

    test('can be called multiple times without throwing', () => {
      defaultInit();
      player.loadTrack('http://example.com/track1.mp3');
      player.unload();
      expect(() => player.unload()).not.toThrow();
    });
  });

  // ======================================================================
  // PLAYBACK CONTROLS
  // ======================================================================

  describe('Playback Controls', () => {
    beforeEach(() => {
      defaultInit();
      player.loadTrack('http://example.com/track1.mp3');
    });

    test('pause() pauses the active element', async () => {
      await Promise.resolve();
      expect(elementA().paused).toBe(false);
      player.pause();
      expect(elementA().paused).toBe(true);
    });

    test('resume() unpauses the active element', async () => {
      await Promise.resolve();
      player.pause();
      expect(elementA().paused).toBe(true);
      player.resume();
      await Promise.resolve();
      expect(elementA().paused).toBe(false);
    });

    test('restart() resets currentTime to 0 and starts playing', async () => {
      player.setProgress(60000); // seek to 60 s
      expect(elementA().currentTime).toBe(60);
      player.restart();
      expect(elementA().currentTime).toBe(0);
      await Promise.resolve();
      expect(elementA().paused).toBe(false);
    });

    test('setProgress() converts ms to seconds on the active element', () => {
      player.setProgress(45000);
      expect(elementA().currentTime).toBe(45);
    });

    test('setProgress(0) seeks to start', () => {
      player.setProgress(50000);
      player.setProgress(0);
      expect(elementA().currentTime).toBe(0);
    });

    test('getCurrentProgress() returns currentTime of the active element in seconds', () => {
      player.setProgress(33000);
      expect(player.getCurrentProgress()).toBe(33);
    });
  });

  // ======================================================================
  // VOLUME CONTROLS
  // ======================================================================

  describe('Volume Controls', () => {
    beforeEach(() => defaultInit());

    test('setVolume() applies to the player element as a fraction', () => {
      player.setVolume(50);
      expect(elementA().volume).toBe(0.5);
    });

    test('setVolume(0) silences the player element', () => {
      player.setVolume(0);
      expect(elementA().volume).toBe(0);
    });

    test('setVolume(100) sets the player element to full volume', () => {
      player.setVolume(100);
      expect(elementA().volume).toBe(1);
    });
  });

  // ======================================================================
  // CALLBACKS AND EVENTS
  // ======================================================================

  describe('Callbacks and Events', () => {
    beforeEach(() => defaultInit());

    test('onLoadStart fires when the active element emits loadstart', async () => {
      player.loadTrack('http://example.com/track1.mp3');
      // MockHTMLAudioElement fires loadstart asynchronously via load()
      await new Promise((r) => setTimeout(r, 100));
      expect(mockCallbacks.onLoadStart).toHaveBeenCalled();
    });

    test('onCanPlay fires when the active element emits canplay', async () => {
      player.loadTrack('http://example.com/track1.mp3');
      await new Promise((r) => setTimeout(r, 200));
      expect(mockCallbacks.onCanPlay).toHaveBeenCalled();
    });

    test('onEnded fires when the active element emits ended', () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3');
      (elementA() as any).mockTriggerEvent('ended');
      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(1);
    });

    test('onError fires with the correct playerElement when the active element errors', () => {
      player.loadTrack('http://example.com/track1.mp3');
      (elementA() as any).mockTriggerEvent('loadstart');
      (elementA() as any).mockTriggerError({});
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
      const callArg = mockCallbacks.onError.mock.calls[0][0];
      expect(callArg).toHaveProperty('event');
      expect(callArg).toHaveProperty('playerElement');
    });

    // Tesla player routes all media errors to onError (no isResetting / empty-src filter).
    // Abort/stale errors are ignored higher up in models.player instead.
    test('onError fires even when error arrives before loadstart', () => {
      player.loadTrack('http://example.com/track1.mp3');
      (elementA() as any).mockTriggerError({});
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
    });

    test('onError fires for MEDIA_ERR_SRC_NOT_SUPPORTED with empty src', () => {
      player.loadTrack('http://example.com/track1.mp3');
      (elementA() as any).mockTriggerEvent('loadstart');
      (elementA() as any).src = '';
      (elementA() as any).error = { code: 4 };
      (elementA() as any).mockTriggerError({});
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
    });

    test('onError fires for MEDIA_ERR_SRC_NOT_SUPPORTED when src is not empty', () => {
      player.loadTrack('http://example.com/track1.mp3');
      (elementA() as any).mockTriggerEvent('loadstart');
      // code=4 with a real src is a genuine unsupported-format error.
      (elementA() as any).error = { code: 4 };
      (elementA() as any).mockTriggerError({});
      expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
    });
  });

  // ======================================================================
  // MULTI-TRACK STATE MANAGEMENT
  // ======================================================================

  describe('Multi-track State Management', () => {
    beforeEach(() => defaultInit());

    test('loading sequential tracks updates src correctly each time', () => {
      player.loadTrack('http://example.com/track1.mp3');
      expect(elementA().src).toBe('http://example.com/track1.mp3');

      player.loadTrack('http://example.com/track2.mp3');
      expect(elementA().src).toBe('http://example.com/track2.mp3');

      player.loadTrack('http://example.com/track3.mp3');
      expect(elementA().src).toBe('http://example.com/track3.mp3');
    });

    test('setNextTrack preloads the next src on a standby element', () => {
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');
      const preloaded = createdElements.find((el) => el.src === 'http://example.com/track2.mp3');
      expect(preloaded).toBeTruthy();
      expect(player.getCurrentPlayerElement()?.src).toBe('http://example.com/track1.mp3');
    });

    test('loadTrack adopts a preloaded standby element instead of reusing the first src', () => {
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');
      const first = player.getCurrentPlayerElement();
      player.loadTrack('http://example.com/track2.mp3');
      const current = player.getCurrentPlayerElement();
      expect(current).not.toBe(first);
      expect(current?.src).toBe('http://example.com/track2.mp3');
      expect(first?.paused).toBe(true);
    });

    test('maybeWarmStartNext does not hand off 2s early while hidden', () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');

      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      const current = player.getCurrentPlayerElement();
      if (current) current.currentTime = 98;

      player.maybeWarmStartNext();

      expect(player.getCurrentPlayerElement()?.src).toBe('http://example.com/track1.mp3');
      expect(mockCallbacks.onEnded).not.toHaveBeenCalled();
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });

    test('maybeWarmStartNext does not hand off 2s early while visible', () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');

      const current = player.getCurrentPlayerElement();
      if (current) current.currentTime = 98;

      player.maybeWarmStartNext();

      expect(player.getCurrentPlayerElement()?.src).toBe('http://example.com/track1.mp3');
      expect(mockCallbacks.onEnded).not.toHaveBeenCalled();
    });

    test('maybeWarmStartNext gapless-hands off in the last 300ms while hidden', async () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');

      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      const current = player.getCurrentPlayerElement();
      if (current) current.currentTime = 99.75;

      player.maybeWarmStartNext();
      await Promise.resolve();
      await Promise.resolve();

      expect(player.getCurrentPlayerElement()?.src).toBe('http://example.com/track2.mp3');
      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });

    test('maybeWarmStartNext gapless-hands off in the last 80ms while visible', async () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');

      const current = player.getCurrentPlayerElement();
      if (current) current.currentTime = 99.95;

      player.maybeWarmStartNext();
      await Promise.resolve();
      await Promise.resolve();

      expect(player.getCurrentPlayerElement()?.src).toBe('http://example.com/track2.mp3');
      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(1);
    });

    test('gapless handoff plus loadTrack does not skip the next song', async () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3');
      player.setNextTrack('http://example.com/track2.mp3');

      const current = player.getCurrentPlayerElement();
      if (current) current.currentTime = 99.95;

      player.maybeWarmStartNext();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(1);
      player.loadTrack('http://example.com/track2.mp3');
      player.setNextTrack('http://example.com/track3.mp3');

      expect(player.getCurrentPlayerElement()?.src).toBe('http://example.com/track2.mp3');
      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(1);
    });

    test('four-track gapless cycle advances one song at a time', async () => {
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      const srcs = [1, 2, 3, 4].map((n) => `http://example.com/track${n}.mp3`);

      player.loadTrack(srcs[0]);
      for (let i = 0; i < 3; i++) {
        player.setNextTrack(srcs[i + 1]);
        const current = player.getCurrentPlayerElement();
        if (current) current.currentTime = 99.95;
        player.maybeWarmStartNext();
        await Promise.resolve();
        await Promise.resolve();
        expect(player.getCurrentPlayerElement()?.src).toBe(srcs[i + 1]);
        player.loadTrack(srcs[i + 1]);
      }

      expect(mockCallbacks.onEnded).toHaveBeenCalledTimes(3);
      expect(player.getCurrentPlayerElement()?.src).toBe(srcs[3]);
    });

    test('getCurrentProgress() returns 0 after unload', () => {
      player.loadTrack('http://example.com/track1.mp3');
      player.setProgress(30000);
      expect(player.getCurrentProgress()).toBe(30); // confirm position was set
      player.unload();
      // unload() explicitly sets currentTime to 0 (without calling load()).
      expect(player.getCurrentProgress()).toBe(0);
    });
  });

  // ======================================================================
  // EDGE CASES
  // ======================================================================

  describe('Edge Cases', () => {
    test('all controls are safe to call before init (no throw)', () => {
      expect(() => player.pause()).not.toThrow();
      expect(() => player.resume()).not.toThrow();
      expect(() => player.restart()).not.toThrow();
      expect(() => player.setVolume(50)).not.toThrow();
      expect(() => player.setProgress(30000)).not.toThrow();
      expect(player.getCurrentProgress()).toBe(0);
    });

    test('loadTrack with empty string src is handled without throwing', () => {
      defaultInit();
      expect(() => player.loadTrack('')).not.toThrow();
      expect(elementA().src).toBe('');
    });

    test('setProgress with a negative value is passed through to the element', () => {
      defaultInit();
      player.loadTrack('http://example.com/track1.mp3');
      // The player does no bounds-checking; the browser would clamp it.
      // Verify no throw and the value is set.
      player.setProgress(-5000);
      expect(elementA().currentTime).toBe(0);
    });

    test('pause then resume restores the saved position if currentTime reset', async () => {
      defaultInit();
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3', 0, true, 200000);
      await Promise.resolve();
      elementA().currentTime = 42;
      player.pause();
      elementA().currentTime = 0;
      player.resume();
      await Promise.resolve();
      expect(elementA().currentTime).toBe(42);
      expect(mockCallbacks.onEnded).not.toHaveBeenCalled();
    });

    test('ended mid-track with known duration does not skip to the next song', () => {
      defaultInit();
      player.setTrackEndedCallback(mockCallbacks.onEnded);
      player.loadTrack('http://example.com/track1.mp3', 50000, true, 200000);
      elementA().currentTime = 50;
      (elementA() as any).ended = true;
      (elementA() as any).mockTriggerEvent('ended');
      expect(mockCallbacks.onEnded).not.toHaveBeenCalled();
      expect(elementA().currentTime).toBe(50);
    });

    test('seek is remembered across a buffer reload', () => {
      defaultInit();
      player.loadTrack('http://example.com/track1.mp3', 0, true, 200000);
      player.setProgress(90000);
      expect(elementA().currentTime).toBe(90);
      elementA().currentTime = 0;
      expect(player.getPlaybackProgressMs()).toBe(90000);
      player.recoverToSavedPosition(false);
      expect(elementA().currentTime).toBe(90);
    });
  });
});
