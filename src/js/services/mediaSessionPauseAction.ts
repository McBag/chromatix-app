/** Ignore a second Media Session pause from the same tap (router + native, or a double event). */
export const mediaSessionPauseToggleDebounceMs = 600;

export type MediaSessionPauseDecision =
  'ignore-play-intent' | 'ignore-duplicate' | 'ignore-in-app-pause' | 'pause' | 'resume';

export type MediaSessionPauseActionInput = {
  sincePlayIntentMs: number;
  playIntentGuardMs: number;
  isManualPause: boolean;
  isMediaSessionManualPause: boolean;
  msSinceLastMediaSessionPause: number;
  toggleDebounceMs?: number;
};

/**
 * Decide what a Media Session `pause` or `stop` should do.
 * A later pause/stop only resumes if the current manual pause came from the
 * Tesla bar, not from the in-app pause button, and only after the debounce
 * window so one tap cannot pause and immediately resume.
 */
export const resolveMediaSessionPauseAction = ({
  sincePlayIntentMs,
  playIntentGuardMs,
  isManualPause,
  isMediaSessionManualPause,
  msSinceLastMediaSessionPause,
  toggleDebounceMs = mediaSessionPauseToggleDebounceMs,
}: MediaSessionPauseActionInput): MediaSessionPauseDecision => {
  if (sincePlayIntentMs < playIntentGuardMs) return 'ignore-play-intent';
  if (isManualPause && isMediaSessionManualPause) {
    if (msSinceLastMediaSessionPause < toggleDebounceMs) return 'ignore-duplicate';
    return 'resume';
  }
  if (isManualPause) return 'ignore-in-app-pause';
  return 'pause';
};

let pausedFromMediaSession = false;
let lastMediaSessionPauseAt = 0;

export const isMediaSessionManualPause = (): boolean => pausedFromMediaSession;

export const msSinceLastMediaSessionPause = (): number =>
  lastMediaSessionPauseAt ? Date.now() - lastMediaSessionPauseAt : Infinity;

export const noteMediaSessionPause = (now = Date.now()): void => {
  pausedFromMediaSession = true;
  lastMediaSessionPauseAt = now;
};

export const clearMediaSessionPauseOrigin = (): void => {
  pausedFromMediaSession = false;
  lastMediaSessionPauseAt = 0;
};
