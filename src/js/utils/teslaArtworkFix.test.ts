import {
  defaultMediaSessionPausePolicy,
  mediaSessionPausePolicy,
  setMediaSessionPausePolicy,
} from 'js/services/mediaSessionPausePolicy';

import {
  formatMediaSessionArtist,
  formatMediaSessionTitle,
  mediaSessionArtworkRetryMs,
  notifyTeslaArtworkLoadStarted,
  notifyTeslaArtworkPlaybackStarted,
  resetTeslaArtworkRetryForTests,
  teslaSetMetadataFromTrack,
} from './teslaArtworkFix';

describe('Testing "formatMediaSessionTitle" function', () => {
  test('Returns the plain track title', () => {
    expect(formatMediaSessionTitle('Hungry for Life')).toBe('Hungry for Life');
  });

  test('Trims whitespace', () => {
    expect(formatMediaSessionTitle('  Hungry for Life  ')).toBe('Hungry for Life');
  });

  test('Falls back to Chromatix when the title is missing', () => {
    expect(formatMediaSessionTitle('')).toBe('Chromatix');
    expect(formatMediaSessionTitle(undefined)).toBe('Chromatix');
    expect(formatMediaSessionTitle('   ')).toBe('Chromatix');
  });
});

describe('Testing "formatMediaSessionArtist" function', () => {
  test('Returns Artist - Album when both are present', () => {
    expect(formatMediaSessionArtist('April Art', 'Fairground')).toBe('April Art - Fairground');
  });

  test('Returns just the artist when no album is present', () => {
    expect(formatMediaSessionArtist('April Art', '')).toBe('April Art');
    expect(formatMediaSessionArtist('April Art', undefined)).toBe('April Art');
    expect(formatMediaSessionArtist('April Art', '   ')).toBe('April Art');
  });

  test('Trims whitespace around artist and album', () => {
    expect(formatMediaSessionArtist('  April Art  ', '  Fairground  ')).toBe('April Art - Fairground');
  });

  test('Returns an empty string when the artist is missing', () => {
    expect(formatMediaSessionArtist('', 'Fairground')).toBe('');
    expect(formatMediaSessionArtist(undefined, 'Fairground')).toBe('');
    expect(formatMediaSessionArtist('', '')).toBe('');
  });
});

describe('Testing "teslaSetMetadataFromTrack" function', () => {
  const originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
  const originalMediaMetadata = globalThis.MediaMetadata;

  beforeEach(() => {
    class FakeMediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: MediaImage[];

      constructor(init: MediaMetadataInit) {
        this.title = init.title ?? '';
        this.artist = init.artist ?? '';
        this.album = init.album ?? '';
        this.artwork = init.artwork ? [...init.artwork] : [];
      }
    }

    globalThis.MediaMetadata = FakeMediaMetadata as typeof MediaMetadata;
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
      },
    });
  });

  afterEach(() => {
    resetTeslaArtworkRetryForTests();
    Object.assign(mediaSessionPausePolicy, defaultMediaSessionPausePolicy);
    vi.useRealTimers();
    globalThis.MediaMetadata = originalMediaMetadata;
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      // @ts-expect-error cleanup in jsdom
      delete navigator.mediaSession;
    }
  });

  test('Sets title to the track title and artist to Artist - Album', () => {
    teslaSetMetadataFromTrack({
      title: 'Hungry for Life',
      artist: 'April Art',
      album: 'Fairground',
    });

    expect(navigator.mediaSession.metadata?.title).toBe('Hungry for Life');
    expect(navigator.mediaSession.metadata?.artist).toBe('April Art - Fairground');
    expect(navigator.mediaSession.metadata?.album).toBe('Fairground');
    expect(navigator.mediaSession.playbackState).toBe('playing');
  });

  test('Keeps a plain artist line when no album is present', () => {
    teslaSetMetadataFromTrack({
      title: 'Hungry for Life',
      artist: 'April Art',
    });

    expect(navigator.mediaSession.metadata?.title).toBe('Hungry for Life');
    expect(navigator.mediaSession.metadata?.artist).toBe('April Art');
    expect(navigator.mediaSession.metadata?.album).toBe('');
  });

  test('Does not replace MediaMetadata when the same artwork is set again', () => {
    const track = {
      title: 'They Escaped the Weight of Darkness',
      artist: 'Agalloch',
      album: 'Marrow of the Spirit',
      thumbMd: 'https://example/thumb-680.jpg',
      thumbSm: 'https://example/thumb-360.jpg',
    };

    teslaSetMetadataFromTrack(track);
    const first = navigator.mediaSession.metadata;
    teslaSetMetadataFromTrack({
      ...track,
      artwork: [{ src: track.thumbMd, sizes: '512x512', type: 'image/jpeg' }],
    });

    expect(navigator.mediaSession.metadata).toBe(first);
    expect(navigator.mediaSession.metadata?.artwork).toHaveLength(1);
    expect(navigator.mediaSession.metadata?.artwork[0].src).toBe(track.thumbMd);
    expect(navigator.mediaSession.playbackState).toBe('playing');
  });

  test('Keeps existing artwork when a later update has no thumb', () => {
    teslaSetMetadataFromTrack({
      title: 'They Escaped the Weight of Darkness',
      artist: 'Agalloch',
      album: 'Marrow of the Spirit',
      thumbMd: 'https://example/thumb-680.jpg',
    });

    teslaSetMetadataFromTrack({
      title: 'Into the Painted Grey',
      artist: 'Agalloch',
      album: 'Marrow of the Spirit',
    });

    expect(navigator.mediaSession.metadata?.title).toBe('Into the Painted Grey');
    expect(navigator.mediaSession.metadata?.artwork).toHaveLength(1);
    expect(navigator.mediaSession.metadata?.artwork[0].src).toBe('https://example/thumb-680.jpg');
  });

  const marrowTrack = {
    title: 'They Escaped the Weight of Darkness',
    artist: 'Agalloch',
    album: 'Marrow of the Spirit',
    albumId: '10039',
    thumbMd: 'https://example/marrow-680.jpg',
  };

  test('forceRetry writes a new MediaMetadata even when the payload is unchanged', () => {
    teslaSetMetadataFromTrack(marrowTrack);
    const first = navigator.mediaSession.metadata;
    teslaSetMetadataFromTrack(marrowTrack, { forceRetry: true });
    expect(navigator.mediaSession.metadata).not.toBe(first);
    expect(navigator.mediaSession.metadata?.artwork[0].src).toBe(marrowTrack.thumbMd);
  });

  test('retries artwork once 1.5 s after playing, not during the load', () => {
    vi.useFakeTimers();
    teslaSetMetadataFromTrack(marrowTrack);
    const first = navigator.mediaSession.metadata;

    notifyTeslaArtworkLoadStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    expect(navigator.mediaSession.metadata).toBe(first);

    notifyTeslaArtworkPlaybackStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs - 1);
    expect(navigator.mediaSession.metadata).toBe(first);

    vi.advanceTimersByTime(1);
    expect(navigator.mediaSession.metadata).not.toBe(first);
    expect(navigator.mediaSession.metadata?.artwork[0].src).toBe(marrowTrack.thumbMd);

    teslaSetMetadataFromTrack({
      ...marrowTrack,
      title: 'Into the Painted Grey',
    });
    expect(navigator.mediaSession.metadata?.title).toBe('Into the Painted Grey');
    const afterTitleChange = navigator.mediaSession.metadata;
    notifyTeslaArtworkPlaybackStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    expect(navigator.mediaSession.metadata).toBe(afterTitleChange);
  });

  test('a later load cancels the pending retry until playing again', () => {
    vi.useFakeTimers();
    teslaSetMetadataFromTrack(marrowTrack);
    const first = navigator.mediaSession.metadata;
    notifyTeslaArtworkPlaybackStarted();
    notifyTeslaArtworkLoadStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    expect(navigator.mediaSession.metadata).toBe(first);

    notifyTeslaArtworkPlaybackStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    expect(navigator.mediaSession.metadata).not.toBe(first);
  });

  test('does not retry when ?msArtRetry=0', () => {
    vi.useFakeTimers();
    setMediaSessionPausePolicy({ retryArtworkAfterPlay: false });
    teslaSetMetadataFromTrack(marrowTrack);
    const first = navigator.mediaSession.metadata;
    notifyTeslaArtworkPlaybackStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    expect(navigator.mediaSession.metadata).toBe(first);
  });

  test('album change arms a new retry', () => {
    vi.useFakeTimers();
    teslaSetMetadataFromTrack(marrowTrack);
    notifyTeslaArtworkPlaybackStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    const afterFirstAlbum = navigator.mediaSession.metadata;

    teslaSetMetadataFromTrack({
      title: 'Limbs',
      artist: 'Agalloch',
      album: 'Ashes Against the Grain',
      albumId: '10028',
      thumbMd: 'https://example/ashes-680.jpg',
    });
    expect(navigator.mediaSession.metadata).not.toBe(afterFirstAlbum);
    const afterAlbumChange = navigator.mediaSession.metadata;
    notifyTeslaArtworkLoadStarted();
    notifyTeslaArtworkPlaybackStarted();
    vi.advanceTimersByTime(mediaSessionArtworkRetryMs);
    expect(navigator.mediaSession.metadata).not.toBe(afterAlbumChange);
    expect(navigator.mediaSession.metadata?.artwork[0].src).toBe('https://example/ashes-680.jpg');
  });
});
