# Chromatix Tesla fork

Tesla-optimized fork of [Chromatix](https://github.com/chromatix-app/chromatix-app), a web music player for Plex and Jellyfin.

This tree is based on Chromatix **0.70.0**. Tesla-oriented behaviour is the default everywhere: there is no user-agent sniffing and no `html[data-is-tesla]` flag at runtime.

Official Chromatix: [chromatix.app](https://chromatix.app/)

## What this fork changes

Built for the Tesla in-car browser (split pane, background tabs, MediaSession):

- Background playback that keeps going when the tab is minimized, including auto-next
- Pause / seek restore the same position after a stall or dropped connection
- Compact ControlBar and touch-sized album cards for the split-browser layout
- Adjacent-album autoplay, AlphabetNav, Recently Added, and Random Albums
- CRA-compatible `build/` output for Tesla static hosting (`npm run build:win`)

Details and file checklist: [`TESLA_CUSTOMIZATIONS_REAPPLY.md`](TESLA_CUSTOMIZATIONS_REAPPLY.md)  
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
