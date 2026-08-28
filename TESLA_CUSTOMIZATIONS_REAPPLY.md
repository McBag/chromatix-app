# Chromatix Tesla Customizations — Version 0.70.0 (Vite)

**Base version:** Chromatix `0.70.0` from [chromatix-app/chromatix-app](https://github.com/chromatix-app/chromatix-app) tag `0.70.0`  
**Tesla layer rooted on:** tag `0.66.0` + customizations, then merged `0.67.0`, `0.68.0`, and `0.70.0`  
**Last updated:** 2026-08-13 (pause/resume position + seek/reconnect recovery)  
**Build system:** Vite 8 + Rolldown (upstream) — **not** CRA  
**Reference tree (older port):** Chromatix Cursor (0.59.0 + Tesla)  
**Routine upgrades:** see **`UPSTREAM_SYNC.md`** (git merge workflow)

This document describes all Tesla customizations applied on top of stock Chromatix. Prefer git merge (`UPSTREAM_SYNC.md`) over full re-apply; use this file when conflicts need intent.

**Fork philosophy:** This tree is a Tesla-optimized Chromatix build. All former Tesla-only behavior (playback keep-alive, MediaSession sync, touch sizing, card controls) is the **default everywhere** — there is **no** `navigator.userAgent` Tesla detection and **no** `html[data-is-tesla]` attribute at runtime. Native playback **preloads the next track** on a standby `<audio>` and, while the tab is hidden, starts it before the current track ends so Tesla does not freeze JS on `ended` (DASH still routed via `player.ts` when needed).

**Explicitly not applied (and reverted if tried):**

- Umlaut transliteration for MediaSession (`ä`→`ae`, `ö`→`oe`, …). Tags keep real Unicode; any “missing umlaut” in Tesla was a bad tag, not a display fix.
- Aggressive first-track cover re-apply / preload / delayed `MediaMetadata` rebuilds (did not fix Tesla cover lag; can cancel artwork loads). Keep the simple `teslaSetMetadataFromTrack` path.

---

## What changed vs. older guides

| Topic | 0.59.0 Cursor (CRA) | 0.66.0 this tree (Vite) |
| ------------- | ----------------------------------- | ---------------------------------------------------------------- | --- | ------ |
| Bundler | Create React App | Vite 8 |
| Env vars | `REACT_APP_*` / `process.env` | `VITE_*` / `import.meta.env` |
| Build | `npm run build:win` → CRA `static/` | `npm run build:win` → Vite + **finalize to CRA layout** |
| Output | `build/static/js/main.*.js` | Same layout after finalize: `static/js                           | css | media` |
| Player router | Native only in Cursor fork | `player.ts` routes native + DASH; Tesla keep-alive on **native** |
| Settings home | `SettingsGeneral` playback block | `SettingsPlayback` (0.66 split) |

---

## Tesla hosting (CRA-compatible layout)

Tesla static hosting expects the **Create React App** deploy tree (as on the live host), **not** Vite’s flat `assets/`:

```
build/
  index.html
  asset-manifest.json
  manifest.json
  robots.txt
  sitemap.xml
  icon/
  images/
  static/
    css/     # *.css
    js/      # entry + chunks
    media/   # fonts, gifs, pngs, …
```

### Files

| File                          | Role                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `package.json`                | `"homepage": "."`, script `"build:win": "node lib/build-win.mjs"`                                   |
| `vite.config.ts`              | `base: './'`; emit into `static/js`, `static/css`, `static/media`                                   |
| `lib/build-win.mjs`           | Sets `VITE_VERSION` / `VITE_DATE`, runs `vite build`, then finalize                                 |
| `lib/finalize-cra-layout.mjs` | Ensures CRA folder layout, relative paths, writes `asset-manifest.json`                             |
| `index.html`                  | Boot spinner (`#app-boot-loader`), relative `./icon/…`, **no** manifest link (Tesla static hosting) |

### Build

```powershell
# from the Tesla fork root
npm.cmd install
npm.cmd run build:win
```

### Deploy

Upload the **entire** `build/` folder contents into the Tesla host `www` directory:

- Replace `index.html`, `static/`, `icon/`, `images/`, `asset-manifest.json`, etc.
- Do **not** upload only `assets/` from a raw Vite build.

### Local preview

```powershell
npx serve -s build -l 4173
```

---

## Background playback vs. stream cleanup (Tesla)

| Event / state                      | Playback                        | Audio unload (`playerUnload` / `src` cleared) |
| ---------------------------------- | ------------------------------- | --------------------------------------------- |
| Tab minimized / `document.hidden`  | **Continues** + auto-next track | **No**                                        |
| `pagehide` / `freeze` while hidden | **Continues** (poll + nudge)    | **No**                                        |
| User Pause                         | Stays paused (no auto-resume)   | **No** — position is snapshotted              |
| Network stall / `online` again     | Resume **same** song + position | **No** (reload same `src` at saved time)      |
| Tab close / navigate away          | Stops                           | **Yes** (`beforeunload` → `playerX.unload()`) |

### Files

| File                                   | Changes                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/js/services/player.native.ts`     | Active + standby `<audio>`, next-track preload, **gapless** A/B handoff (~80 ms visible / ~320 ms hidden — not 2.5 s), track-end polling, hidden stall + **zombie** recovery, **dual keep-alive**, MediaSession helpers, long hide re-assert (≤2 min), **saved position** + seek restore + mid-track `ended` ignore |
| `src/js/services/player.dash.ts`       | Same saved-position / seek / false-`ended` recovery as native; `loadTrack(..., durationMs)` from library metadata                                                                                                                                                                                                   |
| `src/js/services/player.ts`            | Re-exports Tesla helpers from native; routes DASH vs native; passes track `duration`; `recoverToSavedPosition()` on `window.online`                                                                                                                                                                                 |
| `src/js/store/models.player.js`        | `playerAutoNext`, adjacent-album queue, `_manualPause`, ignore `MEDIA_ERR_ABORTED`, `beforeunload` unload; **persist live progress on pause/seek**; transient `MEDIA_ERR_NETWORK` / `DECODE` retry same track (≤5) instead of skip                                                                                  |
| `src/js/hooks/usePlaybackKeepAlive.ts` | Always on; Worker + main interval + cascading timeout when hidden; recovery bursts to 2 min; wall-clock end fallback **does not include pause time**; trusted duration (metadata if element duration collapsed); **no** pause/unload on hide                                                                        |
| `src/js/hooks/useTeslaOptimization.ts` | MediaSession position/`playbackState` only (does **not** rebuild full metadata on poll)                                                                                                                                                                                                                             |
| `src/js/hooks/useMediaControls.ts`     | MediaSession handlers; **ignore pause while `document.hidden`** (Tesla minimize)                                                                                                                                                                                                                                    |
| `src/js/hooks/usePlayerProgress.ts`    | 250 ms progress interval when tab hidden; seek uses a ref + slider value on mouse/touch up so the target is not a stale React state                                                                                                                                                                                 |
| `src/js/components/RangeSlider/`       | `mouseUp` / `touchEnd` pass the live input value into the seek handler                                                                                                                                                                                                                                              |
| `src/js/utils/trustedDuration.ts`      | Prefer live `HTMLAudioElement.duration` when complete; fall back to library metadata when the element duration collapsed after pause / a dropped connection                                                                                                                                                         |
| `src/js/hooks/useMediaMeta.ts`         | Uses `teslaSetMetadataFromTrack`                                                                                                                                                                                                                                                                                    |
| `src/js/app/App.jsx`                   | Calls `usePlaybackKeepAlive()` + `useTeslaOptimization()`; removes boot loader when `inited`                                                                                                                                                                                                                        |

### Behavior notes

- **Manual pause:** `sessionModel._manualPause` set on `playerPause`; cleared on play/resume/new track list. KeepAlive does not auto-resume after user pause. `playerPause` writes the **live** element position into `playingTrackProgress` (not the 30 s-throttled store value).
- **Pause time is not played time:** `usePlaybackKeepAlive` re-seeds `trackStartRef` on resume from `getPlaybackProgressMs()`. Wall-clock auto-next used to include the pause duration, so a long pause then play near the end skipped to the next song.
- **Saved position / seek:** native + DASH keep `lastGoodPositionSec` + `pendingSeekSec`. `resume` / `canplay` / `window.online` call `recoverToSavedPosition`. If `currentTime` jumps to 0 or a collapsed duration end, the saved point is restored (reload same `src` if the element `ended` or has an error).
- **False `ended`:** ignore `ended` when a mid-track position is far from the trusted duration (buffer death / Tesla stream drop). Immediate `ended` at ~0 still advances so broken files do not stall the queue.
- **Trusted duration:** `resolveTrustedDurationSec` prefers the live element when it looks complete; uses library metadata when the element duration collapsed (buffered length ≈ `currentTime`). Live duration that is only a few seconds longer than metadata is trusted (metadata can be short).
- **Track-end advance:** poll + `ended`; `requestTrackAdvance` latch once per track; callback → `playerAutoNext`. Wall-clock fallback only in the **last 2 s** (a stall at 85% is a network freeze, not the end).
- **Gapless A/B:** next src is preloaded on a standby `<audio>`. The next element `play()`s ~80 ms (visible) / ~320 ms (hidden) before the current one ends, then pointers swap. The old 2.5 s hidden warm-start is gone — it started song N+1 early and, after the latch reset in `loadTrack`, could skip another song. `commitGaplessHandoff` will not fire a second auto-next if Redux already adopted the standby. Keep-alive will not wall-clock-advance in the first 2.5 s after a swap.
- **Playback errors:** ignore `MEDIA_ERR_ABORTED` (intentional `src` change). `MEDIA_ERR_NETWORK` / `MEDIA_ERR_DECODE` retry the **same** track at the saved position (≤5), including after pause if the user then resumes. Other errors / exhausted retries still `playerAutoNext` so a truly dead file does not freeze the queue. While `_manualPause` is set, a transient error only flags `playerTrackError` and waits for resume.
- **Seek UI:** `RangeSlider` passes the live input value on mouse/touch up; `usePlayerProgress` keeps a ref so debounce + React state cannot seek to the previous second. `playerProgress` always persists (including while paused).
- **`useTeslaOptimization`:** only `syncHiddenMediaSession` / nudge — **do not** recreate `MediaMetadata` on the poll (cancels cover image loads).
- **MediaSession title format:** `"Artist - Title"` via `formatMediaSessionTitle` (real Unicode, no umlaut rewriting).

---

## Adjacent album autoplay (Tesla-hardened)

### Session defaults (`models.session.js`)

```js
autoPlayPreviousAlbumOnAlbumEnd: true,   // master switch
autoPlayNextAlbumByReleaseYear: false,   // false = older album, true = newer
_adjacentAlbumLoading: false,
_adjacentAlbumPrefetched: false,
_lastQueuedAlbumId: null,
_manualPause: false,
```

### Tesla reliability (why PC worked but car did not)

| Issue                                                       | Fix                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Prefetch only on last 2 tracks + single `setTimeout(0)`     | Prefetch from remaining ≤4, multi-delay schedule, keep-alive kicks |
| Fallback to **all library albums** when discography missing | Same-artist only; never unfiltered library list                    |
| Failed prefetch marked “done forever”                       | Leave `_adjacentAlbumPrefetched` false so retries continue         |
| Album-end gap drops media focus                             | Hold MediaSession + audio keep-alive; long retry loops             |
| `playerLoadAdjacentAlbum` one-shot network                  | Retries with backoff; full `playerLoadAlbum` last resort           |
| Keep-alive never kicked prefetch                            | `usePlaybackKeepAlive` prefetches near album/queue end             |

Also Tesla-oriented defaults:

```js
menuShowBanners: false,
orderArtistAlbums: 'desc',
controlBarAlbum: true,
```

### Settings UI

- `src/js/components/SettingsPlayback/SettingsPlayback.jsx` — Playback section:
  - “Automatically continue with another album by the same artist.”
  - “Play the next album by release year (disable for previous album).” (disabled when first is off)

### Logic (`models.player.js` → adjacent album)

**Bugs that left the queue empty:**

1. Tracks had **no `artistId`** (only `artistLink`) → discography lookup failed when starting from album grid/detail.
2. Sort used non-existent `album.year` instead of **`releaseDate`** (YYYY…).
3. Fallback used `allAlbums[libraryId]` but `allAlbums` is a **flat array**.
4. End-of-album path called `playerLoadAlbum` (replace) instead of **queue insert**.

**Fix:**

1. Sort artist albums **always ascending by release year** (`releaseDate` / `year`), then title.
2. Coerce album IDs with `String(...)` (Plex/Jellyfin mix string/number).
3. `step = autoPlayNextAlbumByReleaseYear ? +1 : -1`
   - `false` (default): **previous / older** album
   - `true`: **next / newer** album
4. Resolve artist via `track.artistId`, `artistLink`, album library row, or session.
5. `prefetchAdjacentAlbum` loads the adjacent album **into the queue** while the current one plays.
6. On album end, `playerLoadAdjacentAlbum` queues (if needed) then `playerNext` — Queue UI shows the tracks.
7. Plex/Jellyfin track transpose sets **`artistId`** (album artist) for discography.

### Queue

- `addAlbumToQueue({ albumId })` inserts tracks **after the current album block** in the queue.
- Adjacent autoplay uses the same insert path (not a full queue replace).

---

## MediaSession artwork / title

### Files

- `src/js/utils/teslaArtworkFix.ts` — `teslaSetMetadataFromTrack`, `formatMediaSessionTitle`
- `src/js/hooks/useMediaMeta.ts`
- ControlBar builds `artwork[]` from `thumbMd` else `thumbSm`

### Tesla player lines

| Line | Field    | Value                                        |
| ---- | -------- | -------------------------------------------- |
| 1    | `title`  | `Artist - Title` (`formatMediaSessionTitle`) |
| 2    | (car UI) | Stream hostname — not overridden             |

Metadata is set on track load (`teslaSetMetadataFromTrack` in `playerLoadTrackList` / `playerLoadIndex`) and via `useMediaMeta`. Unicode is kept as-is.

**Known residual:** Tesla system UI may still show cover only from the second track on some firmware builds. An experimental multi-reapply/preload path was tried and **reverted** (did not help).

---

## ControlBar layout

### Files

- `src/js/components/ControlBar/ControlBar.jsx` + `.module.scss`
- `src/js/components/SettingsControls/SettingsControls.jsx` — Album toggle (`controlBarAlbum`)
- `src/css/base/_wrap.scss` — `--control-bar-height` + slimmer sidebar below 1100px
- `src/css/base/_reset.scss` — `button { min-width: 0 }` so Tesla UA styles cannot stretch icon buttons into ovals

### Layout (Tesla split-browser first)

Tesla’s browser sits in the **right half** of the 15.4″ screen (~900–1100×700 CSS px). The previous 3 equal columns put transport **and** the scrubber in the left column, so the 5 large buttons overflowed and the play button became an oval.

| Area        | Content                                                         |
| ----------- | --------------------------------------------------------------- |
| Transport   | Shuffle / prev / play-pause / next / repeat (auto width)        |
| Now playing | Cover, title, artist, **album** (if enabled), favourite, rating |
| Secondary   | Full page, queue, volume                                        |
| Scrubber    | Full-width row under the three columns                          |

### Sizing

| Viewport        | Play | Other buttons | Bar height | Sidebar |
| --------------- | ---- | ------------- | ---------- | ------- |
| default / Tesla | 52   | 44            | 108        | 168–180 |
| ≥ 1100px        | 60   | 48            | 120        | 200     |
| ≥ 1280px        | 60   | 48            | 120        | 220     |

Buttons are locked with `flex: 0 0 auto`, `min/max-width/height`, `aspect-ratio: 1`, `appearance: none` (same trick as album-card play buttons).

AlphabetNav sits in a reserved 36px gutter so letters no longer overlay artist cards.

Hooks: `useMediaControls` + `useKeyMediaControls` + `useMediaMeta`.

---

## Album cards / TitleHeading / Queue

### Files

- `src/js/components/ViewGrid/ViewGrid.jsx` + `.module.scss`
- `src/js/components/TitleHeading/TitleHeading.jsx` + `.module.scss`
- `src/js/pages/AlbumDetail.jsx`

### Behavior

- Album detail **Queue** → `addAlbumToQueue`
- Album cards: queue control top-right; play/pause bottom-right; controls visible **without hover**
- Queue button background: `var(--color-primary-bg)` (0.66 token; was `primary-background` in older CRA)
- Card buttons: **40 px**; icons **16 px**; no hover scale inflate
- Artist / album link fallbacks when `link` missing

---

## AlphabetNav + artist navigation

### Files

- `src/js/components/AlphabetNav/` (new)
- `src/js/utils/sortList.ts` — `getAlphabetLetter`, `findAlphabetEntryIndex` (diacritics → base letter for buckets only, e.g. `Ü`→`U`)
- `src/js/pages/ArtistArray.jsx` — renders `AlphabetNav` at fragment level
- `src/js/components/ViewGrid/ViewGrid.jsx` / `ViewList.jsx` — `chromatix-scroll-to-index`, `data-entry-index`
- `src/js/services/bridge.js` — per-artist running flags `{ 'libraryId-artistId': true }` so concurrent artist fetches do not block each other; `getAllArtistAlbums` / `getAllArtistTracks` return Promises

### AlphabetNav UI

- Fixed near right edge (`right: 16px`), shifts left when queue open
- Letters: compact boxes; missing letters disabled
- Dispatches `chromatix-scroll-to-index` with `{ detail: { index } }`

---

## Custom library pages

| Route                                  | Page                                           | Sidebar          |
| -------------------------------------- | ---------------------------------------------- | ---------------- |
| `/libraries/:libraryId/recently-added` | `RecentlyAdded.jsx` (albums by `addedAt` desc) | ClockRewind icon |
| `/libraries/:libraryId/random-albums`  | `RandomAlbums.jsx` (shuffled grid)             | Disc icon        |

Files: `src/js/_config/routes.ts`, `src/js/components/SideBar/SideBar.jsx`, `src/js/components/index.js` (exports `AlphabetNav`).

### Sidebar UX (Tesla touch)

- **Library** section is always expanded (no collapse toggle / chevron).
- Larger history arrows (`.nav` / `.prev` / `.next`) and search field (16px text, ~46px height) in `SideBar.module.scss`.

---

## Bridge artist API concurrency

As of upstream **0.67.0**, stock `bridge.js` already uses **`runFetch` / `getRunningFetch`** (shared in-flight Promises per key). That supersedes the older Tesla per-key boolean maps.

On merge conflicts in `bridge.js`: **take upstream**, keep Tesla player/store code that `await`s bridge calls (it re-reads Redux after the promise settles).

---

## New / heavily forked source files (checklist)

| Path                                   | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `src/js/utils/teslaArtworkFix.ts`      | MediaSession title + artwork helper        |
| `src/js/utils/trustedDuration.ts`      | Live vs metadata duration for track-end    |
| `src/js/hooks/usePlaybackKeepAlive.ts` | Background multi-song keep-alive           |
| `src/js/hooks/useTeslaOptimization.ts` | MediaSession position poll                 |
| `src/js/hooks/useMediaControls.ts`     | MediaSession actions (ignore hidden pause) |
| `src/js/components/AlphabetNav/*`      | Letter jump bar                            |
| `src/js/pages/RecentlyAdded.jsx`       | Sidebar page                               |
| `src/js/pages/RandomAlbums.jsx`        | Sidebar page                               |
| `lib/build-win.mjs`                    | Windows Vite build                         |
| `lib/finalize-cra-layout.mjs`          | CRA deploy layout for Tesla static hosting |

### Patched stock files (high level)

- `src/js/services/player.native.ts`, `player.dash.ts`, `player.ts`
- `src/js/store/models.player.js`, `models.session.js`
- `src/js/app/App.jsx`
- `src/js/hooks/index.js`, `useMediaMeta.ts`, `usePlayerProgress.ts`, `usePlaybackKeepAlive.ts`
- `src/js/utils/index.ts`, `sortList.ts`, `trustedDuration.ts`
- `src/js/components/ControlBar/*`, `RangeSlider/*`, `ViewGrid/*`, `ViewList/*`, `TitleHeading/*`, `SideBar/*`, `SettingsPlayback/*`, `SettingsControls/*`
- `src/js/pages/AlbumDetail.jsx`, `ArtistArray.jsx`
- `src/js/_config/routes.ts`
- `src/js/services/bridge.js`
- `vite.config.ts`, `index.html`, `package.json`

---

## Reapply workflow (after a new upstream tag)

**Preferred:** `git fetch upstream --tags` → `git merge <tag>` → resolve → `npm.cmd run build:win` (details in `UPSTREAM_SYNC.md`).

**Fallback** (only if history is unusable):

1. Download the new tag from GitHub into a clean folder.
2. Keep a copy of this `TESLA_CUSTOMIZATIONS_REAPPLY.md`.
3. Re-apply sections above file-by-file (diff against this tree or Chromatix Cursor for intent).
4. Ensure Vite `base: './'` + CRA layout finalize still produce `static/{css,js,media}` + `asset-manifest.json`.
5. Build: `npm.cmd run build:win`
6. Deploy full `build/` contents to the Tesla host `www`.

### Not ported from experimental 0.61 dock work

- `useTeslaDockMode`, PiP, Web Audio media routing beyond the silent keep-alive oscillator
- Vite chunk-splitting beyond existing radix manual chunk
- UA-based Tesla detection

### Ported / maintained

- Bridge per-artist running-flag maps + awaitable artist albums
- ControlBar left/center/right layout + album line + sizing
- AlphabetNav + scroll-to-index
- Background playback without unload on minimize
- Pause/resume + seek restore the same position after a dropped connection
- Adjacent-album autoplay with corrected year ordering
- CRA-compatible deploy layout for Tesla static hosting

---

## Verification checklist

- [ ] `npm.cmd run build:win` succeeds
- [ ] `build/` has `static/css`, `static/js`, `static/media`, `asset-manifest.json`, `icon/`, `images/` (no flat `assets/` only)
- [ ] App loads from deployed `index.html` (boot spinner removed after init)
- [ ] Play → Pause stays paused (no auto-resume from KeepAlive)
- [ ] Pause mid-track → wait → resume: **same song, same position** (does not skip)
- [ ] Pause near the end after a long wait → resume: remaining seconds play (no immediate next)
- [ ] Seek while paused or playing lands on the slider position
- [ ] Drop the connection mid-track, then restore it: continues at the **same** point (no skip / no restart at 0)
- [ ] **Minimized tab:** current track keeps playing
- [ ] **Minimized tab near track end:** next track starts automatically
- [ ] **Minimized tab 3+ tracks:** no silent stall after track 2→3 auto-next
- [ ] **Tab close / `beforeunload`:** streams unload
- [ ] Album card Queue + Play visible without hover; queue button blue
- [ ] Album detail Queue adds album after current album in queue
- [ ] Settings → Playback shows adjacent-album checkboxes
- [ ] Album end continues to **older** album by default; with “by release year” → **newer**
- [ ] Sidebar: Recently Added + Random Albums
- [ ] ControlBar: controls left, cover+meta center (incl. album), no section overlap
- [ ] Artist list: AlphabetNav scrolls to letter (grid + list)
- [ ] MediaSession title uses real umlauts (no ae/oe rewrite)
- [ ] Deploy tree matches existing Tesla host layout in FileZilla
