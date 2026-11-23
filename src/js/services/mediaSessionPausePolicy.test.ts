import {
  applyMediaSessionPausePolicyFromSearch,
  defaultMediaSessionPausePolicy,
  describeMediaSessionPausePolicy,
  mediaSessionPausePolicy,
  parseMediaSessionPausePolicySearch,
  setMediaSessionPausePolicy,
  subscribeMediaSessionPausePolicy,
} from './mediaSessionPausePolicy';

describe('mediaSessionPausePolicy', () => {
  afterEach(() => {
    localStorage.removeItem('chromatix_debug_ms_policy_v3');
    Object.assign(mediaSessionPausePolicy, defaultMediaSessionPausePolicy);
  });

  test('defaults hold the session and keep the silent loop playing', () => {
    applyMediaSessionPausePolicyFromSearch('');
    expect(mediaSessionPausePolicy).toEqual(defaultMediaSessionPausePolicy);
    expect(mediaSessionPausePolicy.keepSilentKeepAlivePlayingOnPause).toBe(true);
    expect(describeMediaSessionPausePolicy()).toBe('hold=1 silentPlaying=1 stopAsPause=0');
  });

  test('parses debug URL flags', () => {
    expect(parseMediaSessionPausePolicySearch('?msSilent=1&msHold=0&msStop=1')).toEqual({
      keepMediaSessionOnManualPause: false,
      keepSilentKeepAlivePlayingOnPause: true,
      registerMediaSessionStopAsPause: true,
    });
    expect(parseMediaSessionPausePolicySearch('msSilent=0')).toEqual({
      keepSilentKeepAlivePlayingOnPause: false,
    });
  });

  test('URL flags override defaults and notify subscribers', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeMediaSessionPausePolicy(() => {
      seen.push(describeMediaSessionPausePolicy());
    });
    applyMediaSessionPausePolicyFromSearch('?msSilent=1');
    setMediaSessionPausePolicy({ registerMediaSessionStopAsPause: true });
    expect(mediaSessionPausePolicy.keepSilentKeepAlivePlayingOnPause).toBe(true);
    expect(mediaSessionPausePolicy.registerMediaSessionStopAsPause).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.at(-1)).toBe('hold=1 silentPlaying=1 stopAsPause=1');
    unsubscribe();
  });
});
