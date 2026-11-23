export type MediaSessionPausePolicy = {
  /** Keep MediaMetadata, playbackState='paused', and position; do not tear down keep-alive. */
  keepMediaSessionOnManualPause: boolean;
  /**
   * Keep the silent loop playing during a held pause (default true). Tesla
   * drops the media card after a stop or a Grok interruption if this is off.
   * When false, the silent element is paused in place (no src reset) and the
   * AudioContext stays open — useful as an experiment, not as the default.
   */
  keepSilentKeepAlivePlayingOnPause: boolean;
  /**
   * Map Media Session `stop` to a session-preserving pause.
   * Off by default — registering it may change the Tesla centre icon.
   */
  registerMediaSessionStopAsPause: boolean;
};

export const defaultMediaSessionPausePolicy: MediaSessionPausePolicy = {
  keepMediaSessionOnManualPause: true,
  keepSilentKeepAlivePlayingOnPause: true,
  registerMediaSessionStopAsPause: false,
};

export const mediaSessionPausePolicy: MediaSessionPausePolicy = {
  ...defaultMediaSessionPausePolicy,
};

const STORAGE_KEY = 'chromatix_debug_ms_policy_v3';
const DEBUG_FLAG_KEY = 'chromatix_debug';

const searchKeyMap = {
  msHold: 'keepMediaSessionOnManualPause',
  msSilent: 'keepSilentKeepAlivePlayingOnPause',
  msStop: 'registerMediaSessionStopAsPause',
} as const;

type PolicyKey = keyof MediaSessionPausePolicy;

const listeners = new Set<() => void>();

export const subscribeMediaSessionPausePolicy = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param === '1') return true;
    if (param === '0') return false;
    return localStorage.getItem(DEBUG_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

const parseBool = (value: string | null): boolean | undefined => {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
};

export const parseMediaSessionPausePolicySearch = (search: string): Partial<MediaSessionPausePolicy> => {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const patch: Partial<MediaSessionPausePolicy> = {};
  (Object.entries(searchKeyMap) as [keyof typeof searchKeyMap, PolicyKey][]).forEach(([param, key]) => {
    const parsed = parseBool(params.get(param));
    if (parsed !== undefined) patch[key] = parsed;
  });
  return patch;
};

const readStoredPolicy = (): Partial<MediaSessionPausePolicy> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<MediaSessionPausePolicy>;
    const patch: Partial<MediaSessionPausePolicy> = {};
    (Object.keys(defaultMediaSessionPausePolicy) as PolicyKey[]).forEach((key) => {
      if (typeof parsed[key] === 'boolean') patch[key] = parsed[key];
    });
    return patch;
  } catch {
    return {};
  }
};

const persistPolicy = (): void => {
  if (typeof window === 'undefined' || !isDebugEnabled()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mediaSessionPausePolicy));
  } catch {
    // ignore
  }
};

export const describeMediaSessionPausePolicy = (policy: MediaSessionPausePolicy = mediaSessionPausePolicy): string =>
  `hold=${policy.keepMediaSessionOnManualPause ? 1 : 0} silentPlaying=${policy.keepSilentKeepAlivePlayingOnPause ? 1 : 0} stopAsPause=${policy.registerMediaSessionStopAsPause ? 1 : 0}`;

export const setMediaSessionPausePolicy = (patch: Partial<MediaSessionPausePolicy>): void => {
  Object.assign(mediaSessionPausePolicy, patch);
  persistPolicy();
  notify();
};

export const applyMediaSessionPausePolicyFromSearch = (search?: string): void => {
  Object.assign(mediaSessionPausePolicy, defaultMediaSessionPausePolicy);
  if (isDebugEnabled()) {
    Object.assign(mediaSessionPausePolicy, readStoredPolicy());
  }
  if (typeof window !== 'undefined' || search != null) {
    const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    Object.assign(mediaSessionPausePolicy, parseMediaSessionPausePolicySearch(query));
  }
};

if (typeof window !== 'undefined') {
  applyMediaSessionPausePolicyFromSearch();
}
