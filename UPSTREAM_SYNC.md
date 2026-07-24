# Upstream sync (Chromatix → Chromarix Tesla fork)

Keep this fork current without re-applying Tesla patches from scratch.

## Remotes

| Remote | URL |
| ------ | --- |
| `upstream` | `https://github.com/chromatix-app/chromatix-app.git` |
| `origin` | your GitHub fork (optional) |

```powershell
# from the Tesla fork root
git remote -v
# If missing:
# git remote add upstream https://github.com/chromatix-app/chromatix-app.git
```

## History layout

```
… upstream history …
    0.66.0
      └── Tesla customizations   (commit on top of 0.66.0)
            └── Merge 0.67.0              (current main)
                  └── later merges…
```

Backup of the pre-rebuild single commit: branch `backup/pre-upstream-rebuild`.

## When a new release appears

```powershell
# from the Tesla fork root

# 1. Fetch tags
git fetch upstream --tags

# 2. See what landed
git log --oneline HEAD..0.68.0   # example tag
git diff --stat HEAD...0.68.0

# 3. Merge the release tag into main
git checkout main
git merge 0.68.0 -m "Merge upstream Chromatix 0.68.0 into Tesla fork"

# 4. Resolve conflicts (typical hotspots)
#    - ControlBar (Tesla layout vs stock)
#    - ViewGrid / ViewList (touch controls + AlphabetNav vs context menus)
#    - bridge.js (prefer upstream runFetch; Tesla await still works via store)
#    - package.json (keep build:win + homepage: ".")

# 5. Install + build Tesla static hosting layout
npm.cmd install
npm.cmd run build:win

# 6. Smoke-test (see TESLA_CUSTOMIZATIONS_REAPPLY.md checklist)
# 7. Commit if merge left uncommitted resolution, then tag optionally
git status
```

## Prefer merge over re-download

Do **not** download a zip and overwrite the tree. Merging preserves:

- Tesla-only files (`usePlaybackKeepAlive`, AlphabetNav, `build-win.mjs`, …)
- Patches in shared files with proper conflict markers
- Ability to `git log` / `git blame` what came from upstream vs Tesla

## Intent guide

Behaviour and file checklist: **`TESLA_CUSTOMIZATIONS_REAPPLY.md`**.

Use that doc when a conflict is large (e.g. full player rewrite) and you need the *why*, not only the diff.

## Bridge note (0.67+)

Upstream 0.67 introduced `runFetch` / `getRunningFetch` (shared in-flight Promises per key). That replaces the older Tesla per-key boolean maps. Prefer upstream `bridge.js` on conflicts; adjacent-album autoplay already re-reads the Redux store after `await`.
