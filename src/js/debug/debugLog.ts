/** Debug-only event log: overlay + batched POST to the Tesla host. No-ops unless started. */

export const DEBUG_LOG_PATH = '/__chromatix-debug-log';
export const DEBUG_LOG_FLUSH_MS = 2000;
export const DEBUG_LOG_BATCH_LINES = 12;
export const DEBUG_LOG_MAX_PAYLOAD = 16 * 1024;

const SECRET_PARAM = /token|key|secret|auth|password/i;

export const redactUrl = (url?: string | null): string => {
  if (!url) return '';
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    parsed.searchParams.forEach((value, key) => {
      if (SECRET_PARAM.test(key)) parsed.searchParams.set(key, 'REDACTED');
    });
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:X-Plex-Token|api_key|ApiKey|access_token|accessToken|token)=)[^&]*/gi, '$1REDACTED');
  }
};

export const isImageDebugMessage = (msg: string): boolean => /^(IMG|ALBUM|MS artwork)\b/.test(msg);

type ImageLogKind = 'cover' | 'thumb' | 'preview' | 'other';

type AlbumRef = {
  id?: string | number | null;
  name?: string | null;
  cover?: string | null;
  thumb?: string | null;
};

let started = false;
let queue: string[] = [];
let flushTimer: number | null = null;
const probing = new Set<string>();
let dlogRef: ((msg: string) => void) | null = null;
const unhook: Array<() => void> = [];

export const isDebugLogStarted = (): boolean => started;

export const setDebugLogSink = (sink: (msg: string) => void): void => {
  dlogRef = sink;
};

const emit = (msg: string): void => {
  if (!started) return;
  if (dlogRef) dlogRef(msg);
  else enqueueRemoteLog(msg);
};

export const enqueueRemoteLog = (msg: string): void => {
  if (!started) return;
  queue.push(`${formatStamp(Date.now())} ${msg}`);
  if (queue.length >= DEBUG_LOG_BATCH_LINES) {
    void flushRemoteLog();
  }
};

const formatStamp = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${oh}:${om}`;
};

export const flushRemoteLog = async (): Promise<void> => {
  if (!started || queue.length === 0) return;
  if (typeof fetch !== 'function') {
    queue = [];
    return;
  }
  const lines: string[] = [];
  let size = 0;
  while (queue.length > 0) {
    const next = queue[0] + '\n';
    if (lines.length > 0 && size + next.length > DEBUG_LOG_MAX_PAYLOAD) break;
    queue.shift();
    if (next.length > DEBUG_LOG_MAX_PAYLOAD) {
      lines.push(`${next.slice(0, DEBUG_LOG_MAX_PAYLOAD - 16)}\n[truncated]\n`);
      break;
    }
    lines.push(next);
    size += next.length;
  }
  const body = lines.join('');
  try {
    await fetch(DEBUG_LOG_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', 'X-Chromatix-Debug': '1' },
      body,
      keepalive: true,
      cache: 'no-store',
    });
  } catch {
    // Swallow network errors — debug logging must never break playback.
  }
};

const kindOf = (img: HTMLImageElement): ImageLogKind => {
  const raw = img.getAttribute('data-debug-kind') || '';
  if (raw === 'cover' || raw === 'thumb' || raw === 'preview') return raw;
  const w = img.naturalWidth || img.width || 0;
  return w >= 300 ? 'cover' : w > 0 ? 'thumb' : 'other';
};

const describeImg = (img: HTMLImageElement, extra = ''): string => {
  const kind = kindOf(img);
  const alt = (img.alt || '').replace(/\s+/g, ' ').trim();
  const url = redactUrl(img.currentSrc || img.src);
  const size = img.naturalWidth ? `${img.naturalWidth}x${img.naturalHeight}` : '0x0';
  return `kind=${kind}${alt ? ` alt=${JSON.stringify(alt)}` : ''} size=${size} url=${url}${extra}`;
};

export const probeFailedImageUrl = async (url: string): Promise<string> => {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return 'status=skipped';
  if (probing.has(url)) return 'status=pending';
  probing.add(url);
  try {
    try {
      const head = await fetch(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store' });
      return `status=${head.status} ok=${head.ok ? 1 : 0} via=HEAD`;
    } catch {
      const get = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Range: 'bytes=0-0' },
      });
      return `status=${get.status} ok=${get.ok ? 1 : 0} via=GET`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `status=0 ok=0 err=${JSON.stringify(message)}`;
  } finally {
    probing.delete(url);
  }
};

export const logMediaSessionArtwork = (
  action: 'set' | 'skip' | 'preserve',
  input: { title?: string; artwork?: { src?: string; sizes?: string; type?: string }[] }
): void => {
  if (!started) return;
  const artwork = input.artwork || [];
  const srcs = artwork
    .filter((item) => item?.src)
    .map((item) => {
      const sizes = item.sizes ? ` sizes=${item.sizes}` : '';
      const type = item.type ? ` type=${item.type}` : '';
      return `src=${redactUrl(item.src)}${sizes}${type}`;
    });
  const title = input.title ? JSON.stringify(input.title) : '-';
  emit(`MS artwork action=${action} title=${title} count=${srcs.length}${srcs.length ? ` ${srcs.join(' ')}` : ''}`);
};

export const logAlbumChange = (input: { source: string; from?: AlbumRef | null; to?: AlbumRef | null }): void => {
  if (!started) return;
  const fmt = (ref?: AlbumRef | null) => {
    if (!ref) return '-';
    const id = ref.id == null || ref.id === '' ? '-' : String(ref.id);
    const name = ref.name ? JSON.stringify(ref.name) : '-';
    return `${id}:${name}`;
  };
  const cover = redactUrl(input.to?.cover || undefined);
  const thumb = redactUrl(input.to?.thumb || undefined);
  emit(
    `ALBUM change source=${input.source} from=${fmt(input.from)} to=${fmt(input.to)}${cover ? ` cover=${cover}` : ''}${thumb ? ` thumb=${thumb}` : ''}`
  );
};

const looksLikeImageMessage = (text: string): boolean =>
  /https?:\/\/\S+\.(?:jpe?g|png|webp|gif|avif)(?:\?|\s|$)/i.test(text) ||
  /\/photo\/:\/transcode|\/Items\/[^/]+\/Images|thumb|cover|artwork/i.test(text);

const startHooks = (): void => {
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    if (!started) return;
    const text = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
    if (looksLikeImageMessage(text)) {
      emit(`IMG console ${text.slice(0, 500)}`);
    }
  };
  unhook.push(() => {
    console.error = origError;
  });

  const onWindowError = (event: ErrorEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && target.tagName === 'IMG') return; // handled by capture listener
    const text = event.message || String(event.error || '');
    if (looksLikeImageMessage(text)) emit(`IMG window ${text.slice(0, 500)}`);
  };
  window.addEventListener('error', onWindowError);
  unhook.push(() => window.removeEventListener('error', onWindowError));

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || '');
    if (looksLikeImageMessage(reason)) emit(`IMG rejection ${reason.slice(0, 500)}`);
  };
  window.addEventListener('unhandledrejection', onRejection);
  unhook.push(() => window.removeEventListener('unhandledrejection', onRejection));

  const onCsp = (event: SecurityPolicyViolationEvent) => {
    const blocked = event.blockedURI || '';
    if (looksLikeImageMessage(blocked) || event.violatedDirective?.includes('img')) {
      emit(
        `IMG csp directive=${event.violatedDirective} blocked=${redactUrl(blocked)} status=${event.statusCode || 0}`
      );
    }
  };
  window.addEventListener('securitypolicyviolation', onCsp);
  unhook.push(() => window.removeEventListener('securitypolicyviolation', onCsp));

  const onImgEvent = (event: Event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
    if (event.type === 'load') {
      emit(`IMG load ${describeImg(img)}`);
      return;
    }
    if (event.type === 'error') {
      const extra = ` event=onerror`;
      emit(`IMG error ${describeImg(img, extra)}`);
      void probeFailedImageUrl(src).then((result) => {
        emit(`IMG status ${describeImg(img, ` ${result}`)}`);
      });
    }
  };
  document.addEventListener('error', onImgEvent, true);
  document.addEventListener('load', onImgEvent, true);
  unhook.push(() => {
    document.removeEventListener('error', onImgEvent, true);
    document.removeEventListener('load', onImgEvent, true);
  });

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flushRemoteLog();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);
  unhook.push(() => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
  });
};

export const startDebugLogging = (): void => {
  if (started || typeof window === 'undefined') return;
  started = true;
  startHooks();
  flushTimer = window.setInterval(() => {
    void flushRemoteLog();
  }, DEBUG_LOG_FLUSH_MS);
};

export const stopDebugLogging = (): void => {
  if (!started) return;
  void flushRemoteLog();
  started = false;
  queue = [];
  if (flushTimer != null) {
    window.clearInterval(flushTimer);
    flushTimer = null;
  }
  unhook.splice(0).forEach((fn) => fn());
};
