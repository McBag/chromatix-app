import { formatMediaSessionArtist, formatMediaSessionTitle, teslaSetMetadataFromTrack } from './teslaArtworkFix';

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
});
