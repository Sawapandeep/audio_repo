# Sync Review + SpeedSync + Preferences — file drop-in guide

These files replace/add to your EXISTING working AudioDrop repo (the one
with Sync already working via the browser confirm() popup). Nothing else
in your repo needs to change — no new dependencies, no backend/Python
changes beyond the one route below.

## New files (add these)
- lib/fsTypes.ts           — shared File System Access API types
- lib/directoryStore.ts    — IndexedDB persistence for the selected folder handle
- lib/preferences.ts       — cookie persistence for format/quality + last-5 playlist history

## Replaced files (overwrite these)
- app/page.tsx             — adds the Sync Review modal, SpeedSync section,
                              folder-handle restore on load, and preference
                              persistence. Normal single/playlist download
                              flow is unchanged.
- app/globals.css           — added styles for the modal, review list, and
                              SpeedSync cards; nothing else was touched.
- app/api/sync/route.ts     — now returns the FULL track list (each tagged
                              existing/missing) plus outputFormats, instead
                              of just a missing[] array + count. This is
                              required for the three-way Review screen.

## What changed in the sync UX
- "Sync now" / "SpeedSync" no longer trigger window.confirm() — they open
  a bottom-sheet "Sync Review" modal showing:
  - Already in folder / New-missing / Local-only counts
  - A per-track list (missing tracks are checkboxed, pre-selected)
  - Shared format/quality selectors (same as normal downloads)
  - "Download N New Songs" to confirm
- SpeedSync cards appear once you've completed at least one sync — they
  remember the last 5 playlists (cookie) and re-run analyze+scan on click,
  but ALWAYS show the Review screen first — never auto-downloads.
- The selected folder handle is now persisted in IndexedDB, so returning
  visitors don't have to re-pick it (subject to the browser still honoring
  the permission — a "Reconnect folder" button appears if it needs re-
  confirming, which requires a click since permission prompts need a user
  gesture).

## Verified
Type-checked with `tsc --noEmit` against this exact file set (page.tsx,
the new lib files, the updated sync route, and your existing unchanged
server/*.py + server/*.ts + other API routes) — no type errors.