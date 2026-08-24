#!/usr/bin/env python3
import json
import shutil
import sys

try:
    import yt_dlp
    version = getattr(yt_dlp.version, '__version__', 'unknown')
except Exception as exc:
    print(json.dumps({'ok': False, 'error': f'yt-dlp import failed: {exc}'}))
    raise SystemExit(1)

ffmpeg = shutil.which('ffmpeg')
print(json.dumps({'ok': bool(ffmpeg), 'ytDlpVersion': version, 'ffmpeg': ffmpeg or None}))
raise SystemExit(0 if ffmpeg else 1)
