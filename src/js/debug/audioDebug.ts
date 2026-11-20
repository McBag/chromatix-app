/* eslint-disable @typescript-eslint/no-explicit-any */
// ======================================================================
// OPT-IN AUDIO DEBUG OVERLAY
// ======================================================================
//
// On-screen event log for diagnosing playback problems in the car. Off by
// default: nothing is hooked and nothing is shown unless enabled.
//
//   ?debug=1  -> enable (remembered in localStorage until switched off)
//   ?debug=0  -> disable
//   × button  -> disable and hide (hooks become pass-through until reload)
//
// When enabled it instruments every audio element, play()/pause()/load()
// calls (with caller names from the stack), the Media Session API,
// AudioContext, page lifecycle and viewport events, and the Redux player
// flags. Must be imported before anything that creates audio elements.

const FLAG_KEY = 'chromatix_debug';

const readEnabled = (): boolean => {
  try {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param === '1') localStorage.setItem(FLAG_KEY, '1');
    if (param === '0') localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

let active = typeof window !== 'undefined' && readEnabled();

export const isDebugEnabled = (): boolean => active;

const MAX_ENTRIES = 300;
const SHOWN_ENTRIES = 60;
const STORAGE_KEY = 'chromatix-debug-audio-log';

interface Entry {
  t: number;
  msg: string;
  count: number;
  lastT: number;
}

let entries: Entry[] = [];
let dirty = false;
let collapsed = false;
let elementSeq = 0;
const elementIds = new WeakMap<object, number>();
let activeElementGetter: (() => HTMLMediaElement | null) | null = null;

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
const fmtTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

const loadSaved = (): void => {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      entries = JSON.parse(saved);
      entries.push({ t: Date.now(), lastT: Date.now(), count: 1, msg: '----- page (re)loaded -----' });
    }
  } catch {
    entries = [];
  }
};

let persistTimer: number | null = null;
const persist = (): void => {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch {
      // ignore
    }
  }, 1000);
};

export const dlog = (msg: string): void => {
  if (!active) return;
  const now = Date.now();
  const last = entries[entries.length - 1];
  if (last && last.msg === msg) {
    last.count += 1;
    last.lastT = now;
  } else {
    entries.push({ t: now, lastT: now, msg, count: 1 });
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  }
  dirty = true;
  persist();
};

export const registerActiveElementGetter = (getter: () => HTMLMediaElement | null): void => {
  activeElementGetter = getter;
};

// ----------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------

const elLabel = (el: any): string => {
  let id = elementIds.get(el);
  if (id == null) {
    id = ++elementSeq;
    elementIds.set(el, id);
  }
  const src: string = el?.src || '';
  let role = 'idle';
  if (activeElementGetter && el === activeElementGetter()) role = 'ACTIVE';
  else if (src.startsWith('blob:')) role = 'silent';
  else if (src) role = 'standby';
  return `#${id}:${role}`;
};

const elState = (el: any): string => {
  const ct = Number.isFinite(el?.currentTime) ? el.currentTime.toFixed(1) : '?';
  return `p=${el?.paused ? 1 : 0} rs=${el?.readyState} t=${ct}`;
};

const IGNORE_FRAMES =
  /callerNames|MediaSession\.set|Patched|patchedPlay|patchedPause|patchedLoad|dlog|Proxy|Array\.forEach|Generator/;

/** Function names of the callers (debug build keeps names unminified). */
const callerNames = (take = 4): string => {
  const stack = new Error().stack || '';
  const names: string[] = [];
  const lines = stack.split('\n').slice(1);
  for (const line of lines) {
    if (IGNORE_FRAMES.test(line)) continue;
    const m = line.match(/at (?:async )?([^\s(]+)/);
    const name = m ? m[1] : '';
    if (!name || name.startsWith('http') || name === 'new') continue;
    names.push(name.replace(/^Object\./, '').replace(/^HTMLAudioElement\./, ''));
  }
  const picked = names.slice(0, take);
  return picked.length ? picked.join('<') : '(event/timer)';
};

// ----------------------------------------------------------------------
// AUDIO ELEMENTS
// ----------------------------------------------------------------------

const MEDIA_EVENTS = [
  'play',
  'playing',
  'pause',
  'waiting',
  'stalled',
  'suspend',
  'ended',
  'emptied',
  'error',
  'ratechange',
  'seeking',
  'seeked',
  'abort',
  'loadstart',
  'canplay',
];

const origCreateElement = document.createElement.bind(document);

const viewport = (): string => {
  const vv = (window as any).visualViewport;
  const vvText = vv ? ` vv=${Math.round(vv.width)}x${Math.round(vv.height)}` : '';
  return `${window.innerWidth}x${window.innerHeight}${vvText}`;
};

const install = (): void => {
  const instrumented = new WeakSet<object>();
  const instrumentElement = (el: any): void => {
    if (!el || instrumented.has(el)) return;
    instrumented.add(el);
    elLabel(el);
    MEDIA_EVENTS.forEach((type) => {
      el.addEventListener(type, () => {
        // Skip idle elements (e.g. the codec probe) that never get a src.
        if (!el.src && type !== 'emptied') return;
        let extra = '';
        if (type === 'error') extra = ` code=${el.error?.code} ${el.error?.message || ''}`;
        dlog(`EV ${type} ${elLabel(el)} ${elState(el)}${extra}`);
      });
    });
  };

  (document as any).createElement = (tagName: string, options?: any) => {
    const el = origCreateElement(tagName, options);
    if (!active) return el;
    const tag = String(tagName).toLowerCase();
    if (tag === 'audio' || tag === 'video') instrumentElement(el);
    return el;
  };

  const mediaProto = (window as any).HTMLMediaElement?.prototype;
  if (mediaProto?.play) {
    const origPlay = mediaProto.play;
    const origPause = mediaProto.pause;
    const origLoad = mediaProto.load;

    mediaProto.play = function patchedPlay(this: any, ...args: any[]) {
      if (!active) return origPlay.apply(this, args);
      instrumentElement(this);
      const label = elLabel(this);
      const wasPaused = this.paused;
      dlog(`CALL play() ${label} wasPaused=${wasPaused ? 1 : 0} from ${callerNames()}`);
      const result = origPlay.apply(this, args);
      if (result && typeof result.then === 'function') {
        result.then(
          () => undefined,
          (err: any) => dlog(`PLAY REJECTED ${label} ${err?.name || ''}: ${err?.message || err}`)
        );
      }
      return result;
    };

    mediaProto.pause = function patchedPause(this: any, ...args: any[]) {
      if (!active) return origPause.apply(this, args);
      instrumentElement(this);
      if (this.src) dlog(`CALL pause() ${elLabel(this)} wasPaused=${this.paused ? 1 : 0} from ${callerNames()}`);
      return origPause.apply(this, args);
    };

    mediaProto.load = function patchedLoad(this: any, ...args: any[]) {
      if (!active) return origLoad.apply(this, args);
      instrumentElement(this);
      if (this.src) dlog(`CALL load() ${elLabel(this)} from ${callerNames()}`);
      return origLoad.apply(this, args);
    };
  }

  // ----------------------------------------------------------------------
  // MEDIA SESSION
  // ----------------------------------------------------------------------

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession as any;
    const origSetActionHandler = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: string, handler: any) => {
      if (typeof handler !== 'function') return origSetActionHandler(action, handler);
      return origSetActionHandler(action, (details: any) => {
        const extra = details?.seekTime != null ? ` seekTime=${details.seekTime}` : '';
        dlog(`MS ACTION ${action}${extra} hidden=${document.hidden ? 1 : 0}`);
        return handler(details);
      });
    };

    const proto = Object.getPrototypeOf(ms);
    const hook = (prop: string, describe: (v: any) => string) => {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc?.set || !desc.get) return;
      Object.defineProperty(ms, prop, {
        configurable: true,
        enumerable: true,
        get() {
          return desc.get!.call(ms);
        },
        set(value: any) {
          if (!active) {
            desc.set!.call(ms, value);
            return;
          }
          const before = desc.get!.call(ms);
          desc.set!.call(ms, value);
          const text = describe(value);
          if (prop !== 'playbackState' || before !== value) {
            dlog(`MS ${prop} = ${text} from ${callerNames()}`);
          } else {
            dlog(`MS ${prop} = ${text} (unchanged)`);
          }
        },
      });
    };
    hook('playbackState', (v) => String(v));
    hook('metadata', (v) => (v ? `"${v.title}" / ${v.artist}` : 'null'));

    if (typeof ms.setPositionState === 'function') {
      const origSetPos = ms.setPositionState.bind(ms);
      ms.setPositionState = (state: any) => {
        dlog('MS setPositionState');
        return origSetPos(state);
      };
    }
  }

  // ----------------------------------------------------------------------
  // AUDIO CONTEXT
  // ----------------------------------------------------------------------

  const OrigAudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (OrigAudioContext) {
    let ctxSeq = 0;
    const Patched = function (this: any, ...args: any[]) {
      const ctx = new OrigAudioContext(...args);
      const id = ++ctxSeq;
      dlog(`AC#${id} created state=${ctx.state}`);
      ctx.addEventListener('statechange', () => dlog(`AC#${id} statechange -> ${ctx.state}`));
      const origResume = ctx.resume.bind(ctx);
      ctx.resume = () => {
        dlog(`AC#${id} resume() state=${ctx.state} from ${callerNames()}`);
        return origResume();
      };
      const origClose = ctx.close.bind(ctx);
      ctx.close = () => {
        dlog(`AC#${id} close()`);
        return origClose();
      };
      return ctx;
    } as any;
    Patched.prototype = OrigAudioContext.prototype;
    (window as any).AudioContext = Patched;
    if ((window as any).webkitAudioContext) (window as any).webkitAudioContext = Patched;
  }

  // ----------------------------------------------------------------------
  // PAGE LIFECYCLE / VIEWPORT
  // ----------------------------------------------------------------------

  document.addEventListener('visibilitychange', () => dlog(`PAGE visibility=${document.visibilityState}`));
  document.addEventListener('freeze', () => dlog('PAGE freeze'));
  document.addEventListener('resume', () => dlog('PAGE resume'));
  window.addEventListener('pagehide', () => dlog('PAGE pagehide'));
  window.addEventListener('pageshow', (e: any) => dlog(`PAGE pageshow persisted=${e?.persisted ? 1 : 0}`));
  window.addEventListener('focus', () => dlog('PAGE focus'));
  window.addEventListener('blur', () => dlog('PAGE blur'));
  window.addEventListener('resize', () => dlog(`PAGE resize ${viewport()}`));
  (window as any).visualViewport?.addEventListener('resize', () => dlog(`PAGE vv-resize ${viewport()}`));
  window.addEventListener('online', () => dlog('NET online'));
  window.addEventListener('offline', () => dlog('NET offline'));
  window.addEventListener('error', (e: any) => dlog(`JS ERROR ${e?.message || e}`));
  window.addEventListener('unhandledrejection', (e: any) => {
    const r = e?.reason;
    dlog(`JS REJECTION ${r?.name || ''}: ${r?.message || r}`);
  });
};

// ----------------------------------------------------------------------
// REDUX STORE
// ----------------------------------------------------------------------

export const watchStore = (store: any): void => {
  if (!active) return;
  let prev = '';
  const read = () => {
    const s = store.getState();
    const p = s.playerModel || {};
    const ss = s.sessionModel || {};
    return `playing=${p.playerPlaying ? 1 : 0} loading=${p.playerLoading ? 1 : 0} loaded=${
      p.playerTrackLoaded ? 1 : 0
    } error=${p.playerTrackError ? 1 : 0} manualPause=${ss._manualPause ? 1 : 0} idx=${ss.playingTrackIndex}`;
  };
  prev = read();
  dlog(`STORE ${prev}`);
  store.subscribe(() => {
    const next = read();
    if (next !== prev) {
      prev = next;
      dlog(`STORE ${next}`);
    }
  });
};

// ----------------------------------------------------------------------
// CONTROL BAR HEIGHT
// ----------------------------------------------------------------------

const watchControlBar = (): void => {
  let observed: Element | null = null;
  let lastHeight = -1;
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((items) => {
          const h = Math.round(items[0]?.contentRect?.height ?? -1);
          if (h !== lastHeight) {
            lastHeight = h;
            dlog(`BAR height=${h}px viewport=${viewport()}`);
          }
        })
      : null;
  window.setInterval(() => {
    if (!active) return;
    const el = document.querySelector('[data-debug-controlbar]');
    if (el && el !== observed && ro) {
      if (observed) ro.unobserve(observed);
      observed = el;
      ro.observe(el);
    }
  }, 1000);
};

// ----------------------------------------------------------------------
// OVERLAY
// ----------------------------------------------------------------------

const buildOverlay = (): void => {
  const root = origCreateElement('div');
  root.id = 'chromatix-debug-overlay';
  root.style.cssText = [
    'position:fixed',
    'top:8px',
    'right:8px',
    'z-index:2147483647',
    'width:min(62vw,900px)',
    'max-height:70vh',
    'display:flex',
    'flex-direction:column',
    'background:rgba(0,0,0,0.82)',
    'color:#fff',
    'font:17px/1.3 ui-monospace,Menlo,Consolas,monospace',
    'border:2px solid #ff0',
    'border-radius:8px',
    'pointer-events:auto',
  ].join(';');

  const bar = origCreateElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px;flex:0 0 auto';
  const mkBtn = (label: string): HTMLButtonElement => {
    const b = origCreateElement('button') as HTMLButtonElement;
    b.textContent = label;
    b.style.cssText =
      'font:bold 18px sans-serif;padding:8px 14px;background:#ff0;color:#000;border:0;border-radius:6px;cursor:pointer';
    return b;
  };
  const toggle = mkBtn('LOG –');
  const clear = mkBtn('Clear');
  const mark = mkBtn('Mark');
  const title = origCreateElement('span');
  title.style.cssText = 'font-size:13px;opacity:0.8;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  title.textContent = `Chromatix DEBUG ${import.meta.env.VITE_VERSION || ''}`.trim();
  const close = mkBtn('×');
  close.title = 'Debug-Overlay ausschalten';
  close.style.marginLeft = 'auto';
  bar.append(toggle, clear, mark, title, close);

  const ua = origCreateElement('div');
  ua.style.cssText = 'font-size:12px;padding:0 6px 4px;opacity:0.75;word-break:break-all;flex:0 0 auto';
  ua.textContent = `UA: ${navigator.userAgent}`;

  const list = origCreateElement('div');
  list.style.cssText = 'overflow-y:auto;padding:0 6px 6px;flex:1 1 auto;white-space:pre-wrap;word-break:break-word';

  root.append(bar, ua, list);

  const colorFor = (msg: string): string => {
    if (msg.startsWith('CALL play')) return '#7f7';
    if (msg.startsWith('CALL pause')) return '#f88';
    if (msg.startsWith('PLAY REJECTED') || msg.startsWith('JS')) return '#f55';
    if (msg.startsWith('MS ACTION')) return '#ff0';
    if (msg.startsWith('MS')) return '#fc6';
    if (msg.startsWith('STORE')) return '#6cf';
    if (msg.startsWith('PAGE') || msg.startsWith('BAR')) return '#d9f';
    if (msg.startsWith('AC')) return '#9ff';
    return '#ddd';
  };

  const render = () => {
    if (collapsed) return;
    const shown = entries.slice(-SHOWN_ENTRIES).reverse();
    list.textContent = '';
    shown.forEach((e) => {
      const row = origCreateElement('div');
      row.style.color = colorFor(e.msg);
      const rep = e.count > 1 ? `  ×${e.count} (bis ${fmtTime(e.lastT)})` : '';
      row.textContent = `${fmtTime(e.t)} ${e.msg}${rep}`;
      list.appendChild(row);
    });
  };

  toggle.onclick = () => {
    collapsed = !collapsed;
    list.style.display = collapsed ? 'none' : 'block';
    ua.style.display = collapsed ? 'none' : 'block';
    title.style.display = collapsed ? 'none' : 'inline';
    clear.style.display = collapsed ? 'none' : 'inline-block';
    mark.style.display = collapsed ? 'none' : 'inline-block';
    root.style.width = collapsed ? 'auto' : 'min(62vw,900px)';
    toggle.textContent = collapsed ? 'LOG +' : 'LOG –';
    if (!collapsed) render();
  };
  clear.onclick = () => {
    entries = [];
    dirty = true;
    persist();
    render();
  };
  mark.onclick = () => dlog('===== MARK =====');
  close.onclick = () => {
    active = false;
    try {
      localStorage.removeItem(FLAG_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    window.clearInterval(renderTimer);
    root.remove();
  };

  // Keep touches on the overlay from reaching the app underneath.
  ['click', 'pointerdown', 'keydown'].forEach((type) => root.addEventListener(type, (e) => e.stopPropagation()));

  document.body.appendChild(root);
  const renderTimer = window.setInterval(() => {
    if (!active) return;
    if (dirty) {
      dirty = false;
      render();
    }
  }, 300);
  render();
};

if (active) {
  loadSaved();
  install();
  dlog(
    `START ${import.meta.env.VITE_VERSION || ''} ${window.location.href} viewport=${viewport()} visibility=${document.visibilityState}`
  );
  if (document.body) {
    buildOverlay();
    watchControlBar();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      buildOverlay();
      watchControlBar();
    });
  }
}
