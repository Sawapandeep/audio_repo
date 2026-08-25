# AudioDrop — yt-dlp Audio Downloader

Phase 1 Next.js application around the existing yt-dlp extraction engine, with playlist synchronization.

## Implemented PRD

The supplied PRD asks for a yt-dlp clone with a sync/repository-style function: when a user's YouTube playlist gains a song, scan the local download folder and download the song only when it is not already present.

The implementation adds:

- **Playlist Sync** panel in the existing mobile-first UI.
- User selects the local audio folder through the browser's File System Access API.
- The app scans the selected folder for AudioDrop filenames containing YouTube video IDs such as `Song Title [VIDEO_ID].mp3`.
- `/api/sync` analyzes the playlist and returns only tracks whose video IDs are absent from the local folder.
- Missing tracks are downloaded through the existing yt-dlp/FFmpeg backend and written directly into the selected folder when browser folder-write access is available.
- A manual **Sync now** action.
- Optional automatic checking every five minutes while the page is open. If new tracks are detected, the user is prompted before they are downloaded.
- Existing single-video and bulk-playlist download flows remain intact.

## Important browser limitation

A normal website cannot silently watch a user's arbitrary filesystem or continuously run when the page is closed. Automatic checking therefore works only while AudioDrop is open, and the browser must grant folder access.

The sync mechanism intentionally uses YouTube video IDs rather than title matching. This avoids false duplicates caused by title changes, punctuation, or different metadata.

If the browser does not support the File System Access API, normal download behavior can still be used, but direct writing into the selected folder is not available.

## Architecture

- Next.js App Router frontend + Node route handlers
- Python service for yt-dlp and FFmpeg
- Temporary server-side files only for normal downloads
- Single downloads are returned directly to the browser
- Playlist downloads run as background jobs and are returned as a ZIP
- Sync downloads are streamed to the browser and written to the user-selected directory
- No accounts, database, history, cloud storage, payments, or analytics

## Setup

1. Install Node.js 20+.
2. Install Python 3.10+.
3. Install/import the configured yt-dlp version.
4. Put FFmpeg on PATH.
5. Copy `.env.example` to `.env.local` and set `PYTHON_BIN` if required.
6. If using a source checkout, set `YT_DLP_PYTHONPATH` to its parent directory.
7. Run `npm install`.
8. Run `npm run dev`.

The supplied runtime pins `yt-dlp==2026.08.19` and `yt-dlp-ejs==0.8.0`.

## Production

Use a persistent Node/Python host or container for Phase 1. The playlist job manager is process-local and is not suitable for a stateless serverless runtime. The sync watcher is likewise browser-local and only operates while the page is open.

A later phase can replace the process-local job manager and browser polling with a durable queue/background worker if always-on playlist monitoring is required.
