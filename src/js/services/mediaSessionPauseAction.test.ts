import {
  clearMediaSessionPauseOrigin,
  isMediaSessionManualPause,
  mediaSessionPauseToggleDebounceMs,
  msSinceLastMediaSessionPause,
  noteMediaSessionPause,
  resolveMediaSessionPauseAction,
} from './mediaSessionPauseAction';

const base = {
  playIntentGuardMs: 2000,
  toggleDebounceMs: mediaSessionPauseToggleDebounceMs,
};

describe('resolveMediaSessionPauseAction', () => {
  afterEach(() => {
    clearMediaSessionPauseOrigin();
  });

  test('ignores a pause in the play-intent guard window', () => {
    expect(
      resolveMediaSessionPauseAction({
        ...base,
        sincePlayIntentMs: 200,
        isManualPause: false,
        isMediaSessionManualPause: false,
        msSinceLastMediaSessionPause: Infinity,
      })
    ).toBe('ignore-play-intent');
  });

  test('pauses when playback is running', () => {
    expect(
      resolveMediaSessionPauseAction({
        ...base,
        sincePlayIntentMs: 5000,
        isManualPause: false,
        isMediaSessionManualPause: false,
        msSinceLastMediaSessionPause: Infinity,
      })
    ).toBe('pause');
  });

  test('ignores a second Media Session pause within the debounce window', () => {
    expect(
      resolveMediaSessionPauseAction({
        ...base,
        sincePlayIntentMs: 5000,
        isManualPause: true,
        isMediaSessionManualPause: true,
        msSinceLastMediaSessionPause: 100,
      })
    ).toBe('ignore-duplicate');
  });

  test('resumes on a later Media Session pause after a Tesla-bar pause', () => {
    expect(
      resolveMediaSessionPauseAction({
        ...base,
        sincePlayIntentMs: 5000,
        isManualPause: true,
        isMediaSessionManualPause: true,
        msSinceLastMediaSessionPause: 800,
      })
    ).toBe('resume');
  });

  test('does not resume when the pause came from the in-app button', () => {
    expect(
      resolveMediaSessionPauseAction({
        ...base,
        sincePlayIntentMs: 5000,
        isManualPause: true,
        isMediaSessionManualPause: false,
        msSinceLastMediaSessionPause: Infinity,
      })
    ).toBe('ignore-in-app-pause');
  });

  test('noteMediaSessionPause marks origin and can be cleared', () => {
    expect(isMediaSessionManualPause()).toBe(false);
    expect(msSinceLastMediaSessionPause()).toBe(Infinity);
    noteMediaSessionPause(Date.now() - 50);
    expect(isMediaSessionManualPause()).toBe(true);
    expect(msSinceLastMediaSessionPause()).toBeGreaterThanOrEqual(50);
    expect(msSinceLastMediaSessionPause()).toBeLessThan(600);
    clearMediaSessionPauseOrigin();
    expect(isMediaSessionManualPause()).toBe(false);
    expect(msSinceLastMediaSessionPause()).toBe(Infinity);
  });
});
