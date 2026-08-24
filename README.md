# AudioDrop — yt-dlp Audio Downloader

Phase 1 Next.js web application around the existing yt-dlp extraction engine.

## Architecture

- Next.js App Router frontend + Node route handlers
- Python service for yt-dlp and FFmpeg
- Temporary server-side files only
- Single downloads are returned directly to the browser
- Playlist downloads run as background jobs and are returned as a ZIP
- No accounts, database, history, cloud storage, payments, or analytics

## Requirements

- Node.js 20+
- Python 3.10+
- yt-dlp installed/importable by the configured Python interpreter
- FFmpeg on PATH
- A JavaScript runtime supported by the installed yt-dlp version may be required for YouTube extraction

## Setup

1. Install Node dependencies: `npm install`
2. Install the Python dependencies required by the exact yt-dlp version you use.
3. Copy `.env.example` to `.env.local` and set `PYTHON_BIN` if needed.
4. If using a source checkout, point `YT_DLP_PYTHONPATH` at its parent directory.
5. Start with `npm run dev`.

The `vendor/yt_dlp` directory contains the uploaded yt-dlp source snapshot for reference. The snapshot supplied to this workspace is not used as a runtime dependency because the ingested dump is not a complete installable checkout; the app instead loads the actual installed yt-dlp package through Python.

## Production note

Use a persistent Node/Python host or container for Phase 1. The playlist job manager is intentionally process-local and therefore is not suitable for a stateless serverless runtime. A later phase can replace it with a durable queue if required.
