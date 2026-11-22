import { formatMediaSessionTitle, teslaSetMetadataFromTrack } from './teslaArtworkFix';

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
    globalThis.MediaMetadata = originalMediaMetadata;
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      // @ts-expect-error cleanup in jsdom
      delete navigator.mediaSession;
    }
  });

  test('Sets title to the track title only; artist and album stay in their fields', () => {
    teslaSetMetadataFromTrack({
      title: 'Hungry for Life',
      artist: 'April Art',
      album: 'Some Album',
    });

    expect(navigator.mediaSession.metadata?.title).toBe('Hungry for Life');
    expect(navigator.mediaSession.metadata?.artist).toBe('April Art');
    expect(navigator.mediaSession.metadata?.album).toBe('Some Album');
    expect(navigator.mediaSession.playbackState).toBe('playing');
  });
});
