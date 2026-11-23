import {
  DEBUG_LOG_PATH,
  enqueueRemoteLog,
  isDebugLogStarted,
  isImageDebugMessage,
  logAlbumChange,
  logMediaSessionArtwork,
  redactUrl,
  startDebugLogging,
  stopDebugLogging,
} from './debugLog';

describe('debugLog', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    stopDebugLogging();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  });

  afterEach(() => {
    stopDebugLogging();
    globalThis.fetch = originalFetch;
  });

  test('redacts access tokens in image URLs', () => {
    const url =
      'https://plex.example/photo/:/transcode?width=680&url=%2Flibrary%2Fmetadata%2F1&X-Plex-Token=secret-token';
    expect(redactUrl(url)).toContain('X-Plex-Token=REDACTED');
    expect(redactUrl(url)).not.toContain('secret-token');
    expect(redactUrl(url)).toContain('width=680');
  });

  test('isImageDebugMessage matches cover, album, and Media Session artwork lines only', () => {
    expect(isImageDebugMessage('IMG error kind=cover url=https://example/x.jpg')).toBe(true);
    expect(isImageDebugMessage('ALBUM change source=route from=- to=1:"News"')).toBe(true);
    expect(isImageDebugMessage('MS artwork action=set title="Limbs" count=1 src=https://example/x.jpg')).toBe(true);
    expect(isImageDebugMessage('MS pause accepted -> playerPause (hold session)')).toBe(false);
    expect(isImageDebugMessage('CALL play')).toBe(false);
  });

  test('does not POST unless debug logging has started', async () => {
    enqueueRemoteLog('IMG error should not send');
    await Promise.resolve();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(isDebugLogStarted()).toBe(false);
  });

  test('batches lines to the debug endpoint after start', async () => {
    startDebugLogging();
    logAlbumChange({
      source: 'route',
      from: { id: '1', name: 'Old' },
      to: { id: '2', name: 'New', cover: 'https://example/cover.jpg?X-Plex-Token=sekrit' },
    });
    for (let i = 0; i < 12; i += 1) {
      enqueueRemoteLog(`IMG load kind=cover url=https://example/${i}.jpg`);
    }
    await Promise.resolve();
    expect(globalThis.fetch).toHaveBeenCalled();
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(DEBUG_LOG_PATH);
    expect(init.method).toBe('POST');
    expect(init.body).toContain('ALBUM change');
    expect(init.body).toContain('IMG load');
    expect(init.body).not.toContain('sekrit');
    expect(init.body).toContain('REDACTED');
  });

  test('logMediaSessionArtwork redacts tokens and no-ops when stopped', async () => {
    logMediaSessionArtwork('set', {
      title: 'Limbs',
      artwork: [
        {
          src: 'https://example/photo/:/transcode?width=680&X-Plex-Token=sekrit',
          sizes: '512x512',
          type: 'image/jpeg',
        },
      ],
    });
    await Promise.resolve();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    startDebugLogging();
    logMediaSessionArtwork('set', {
      title: 'Limbs',
      artwork: [
        {
          src: 'https://example/photo/:/transcode?width=680&X-Plex-Token=sekrit',
          sizes: '512x512',
          type: 'image/jpeg',
        },
      ],
    });
    for (let i = 0; i < 12; i += 1) {
      enqueueRemoteLog(`IMG load kind=cover url=https://example/${i}.jpg`);
    }
    await Promise.resolve();
    expect(globalThis.fetch).toHaveBeenCalled();
    const body = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string;
    expect(body).toContain('MS artwork action=set');
    expect(body).toContain('title="Limbs"');
    expect(body).toContain('sizes=512x512');
    expect(body).not.toContain('sekrit');
    expect(body).toContain('REDACTED');
  });
});
