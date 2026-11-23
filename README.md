# Chromatix Tesla fork

Tesla-optimized fork of [Chromatix](https://github.com/chromatix-app/chromatix-app), a web music player for Plex and Jellyfin.

This tree is based on Chromatix **1.0.0** (upstream tag `1.0.0`). Tesla-oriented behaviour is the default everywhere: there is no user-agent sniffing and no `html[data-is-tesla]` flag at runtime.

Official Chromatix: [chromatix.app](https://chromatix.app/)

## What's different from upstream (chromatix-app/chromatix-app)

This fork is maintained for the Tesla in-car browser (split pane, background tabs, Media Session). The changes below are in this tree and are not in [upstream Chromatix](https://github.com/chromatix-app/chromatix-app).

### Start page and in-car UI

- The web app opens on the **login form** (`PageLogin`) instead of the upstream marketing page, so the first screen in the car is a login. The Electron desktop app still uses the shorter landing page with login buttons.
- Larger back/forward **nav arrows**: a 24×24 icon inside a 52×48 touch target.
- Compact ControlBar for the Tesla split-browser pane: **52px** play button (44px for the other transport buttons), 108px bar height, and a full-width scrubber under the controls. From 1100px wide the bar steps up (60px play button).
- Larger sidebar **search field** (16px text, 46px minimum height).
- Album-card **queue and play buttons** are always visible (no hover), 40px hits, with the queue button in the primary colour. The Library section stays expanded (no collapse chevron).
- **AlphabetNav** letter jump bar on artist lists, in a reserved gutter so letters do not overlay cards.

### Playback and Media Session

- Background playback continues when the tab is minimized, including auto-next. Native playback preloads the next track on a standby `<audio>` element and, while the tab is hidden, starts it before the current track ends so the car cannot freeze JavaScript on `ended`.
- A near-silent keep-alive (Web Audio oscillator plus a looping silent `<audio>` element) holds Tesla media focus.
- Pause and seek restore the same position after a stall or a dropped connection. Keep-alive does not auto-resume a track the user paused.
- **2 second Media Session pause guard** (`playIntentPauseGuardMs`): the car often sends a spurious `pause` within ~30 ms after playback resumes from another source; that pause is ignored.
- **Stop / resume from the Tesla media bar is verified working** in the car: the first tap on the centre square pauses and keeps the card; a second tap resumes. There is no play triangle — that is a Tesla limitation (the silent keep-alive stays playing so the card is not dropped after a stop or a Grok call). A 600 ms debounce ignores the duplicate pause from the same tap, so one tap cannot pause and immediately resume. This toggle applies only when the pause came from the Tesla bar, not from the in-app pause button.
- Adjacent-album autoplay (default: continue to the older album by release year) and queue-insert of that album.

### Library pages and media card

- **Recently Added** and **Random Albums** sidebar pages (not in upstream). Their list headers are sticky in the same way as the Albums tab (the title block is passed as `ViewList` / `ViewGrid` children).
- The album page reuses cached album info and artwork from `allArtistAlbums` and similar lists (IDs compared with `String()`), so the header can appear immediately with a known thumb. The large header uses the 680px `thumbMd` image, with the 360px thumb as a fallback until that loads.
- Media Session **title is the track title only**; the second line is **Artist - Album** when an album is present (`teslaArtworkFix.ts`). Unicode, including umlauts, is left as-is. Artwork is taken from the track's medium or small thumb. Identical Media Session metadata is not written again (the player and the ControlBar hook both call `teslaSetMetadataFromTrack`; a second write can cancel Tesla's in-flight cover load). A follow-up update without artwork keeps the cover already on the card. A known residual: on some Tesla firmware the cover may still appear only from the second track.

### Debug overlay

The opt-in overlay lives permanently on `main`. It is hidden unless enabled:

- `?debug=1` — show the overlay (remembered in `localStorage`); the header includes the app version
- `?debug=0` or the `×` button — hide it
- The overlay **Images** button (next to LOG / Clear / Mark) shows cover, thumbnail, album-change, and Media Session artwork lines (`MS artwork action=set|skip|preserve`)
- While the overlay is on, the same events (including image load/failure with HTTP status, album changes, and Media Session / playback lines) are batched to `POST /__chromatix-debug-log` and appended on the Tesla host at `~/logs/chromatix-debug.log`. Nothing is sent or written when debug is off
- `?msSilent=0` — pause the silent keep-alive during a held pause (experiment; the card may disappear after a Grok call or a stop)
- `?msHold=0` — tear down keep-alive on pause
- `?msStop=1` — register Media Session `stop` as a session-preserving pause (may change the car's centre icon)

### Hosting and branches

- `npm run build:win` produces a CRA-style `build/` tree (`index.html`, `static/{js,css,media}`, `icon/`, `images/`, `asset-manifest.json`) for Tesla static hosting. Do not deploy Vite's raw `assets/` output. `"homepage": "."` keeps asset URLs relative.
- On the Ultra.cc nginx host, `index.html` is served with `Cache-Control: no-cache` (the car caches HTML aggressively otherwise) and `/static` assets with a long immutable cache.
- `@vercel/analytics` is mounted only on `*.vercel.app`. On the Ultra.cc host it is omitted so the car does not load `/_vercel/insights/script.js` (that path falls back to `index.html` and throws `Unexpected token '<'`).
- Upstream updates are merged from tags (see [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md)). Snapshot branches `release/<version>` keep the last three versions: `release/1.0.0` (upstream Chromatix 1.0.0, plus Tesla work through the Artist - Album media-card line), `release/0.74.0`, and `release/0.73.0`. Later Media Session pause/resume work is on `main`.

### Known limits

- The Tesla media bar does not show a play triangle while this fork keeps the silent keep-alive playing (required so the card stays after a stop or a Grok call). Resume is the second tap on the stop square.
- Tesla Light Sync does not work with browser audio. That is a vehicle limit, not something this fork can enable.
- This fork does not transliterate umlauts in Media Session text, and it does not use an aggressive artwork re-apply path (tried, did not help, reverted).

Details and a file checklist: [`TESLA_CUSTOMIZATIONS_REAPPLY.md`](TESLA_CUSTOMIZATIONS_REAPPLY.md)  
Merging a new upstream tag: [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md)

## Getting started

```bash
npm install
npm start
```

Dev server: Vite on port 4000.

## Tesla build

```bash
npm install
npm run build:win
```

That produces a CRA-style tree under `build/` (`index.html`, `static/{css,js,media}`, `icon/`, `images/`, `asset-manifest.json`). Upload the **entire** `build/` contents to the Tesla host `www` directory. Do not deploy Vite’s raw `assets/` output.

Local preview:

```bash
npx serve -s build -l 4173
```

## Tech stack

Same as upstream Chromatix: Vite 8, React 18, Rematch (Redux), Sass, Radix UI, Tanstack Virtual. Player code lives in `src/js/services/player*.ts`; playback policy is in `src/js/store/models.player.js`.

## License

This is a personal fork of Chromatix for Tesla use. Upstream is open source for transparency, but **not** for redistribution. You may download, modify, and build it for personal use.

If the [upstream repo](https://github.com/chromatix-app/chromatix-app) goes more than 12 months without commits, upstream grants permission to use and distribute the code without limitation from 12 months after that last commit.

Not affiliated with the Chromatix author. For official Chromatix issues and the roadmap, use [Featurebase](https://chromatix.featurebase.app/roadmap) or the [upstream repo](https://github.com/chromatix-app/chromatix-app).
