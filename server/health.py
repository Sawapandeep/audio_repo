# #!/usr/bin/env python3
#!/usr/bin/env python3
import json
import shutil
import subprocess
import sys

try:
    import yt_dlp
    version = getattr(yt_dlp.version, '__version__', 'unknown')
except Exception as exc:
    print(json.dumps({
        'ok': False,
        'error': f'yt-dlp import failed: {exc}'
    }))
    raise SystemExit(1)

ffmpeg = shutil.which('ffmpeg')
deno = shutil.which('deno')

deno_version = None

if deno:
    try:
        result = subprocess.run(
            ['deno', '--version'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        deno_version = result.stdout.splitlines()[0] if result.stdout else None
    except Exception:
        pass

result = {
    'ok': bool(ffmpeg and deno),
    'ytDlpVersion': version,
    'ffmpeg': ffmpeg or None,
    'deno': deno or None,
    'denoVersion': deno_version,
}

print(json.dumps(result))
raise SystemExit(0 if result['ok'] else 1)
# import json
# import shutil
# import sys

# try:
#     import yt_dlp
#     version = getattr(yt_dlp.version, '__version__', 'unknown')
# except Exception as exc:
#     print(json.dumps({'ok': False, 'error': f'yt-dlp import failed: {exc}'}))
#     raise SystemExit(1)

# ffmpeg = shutil.which('ffmpeg')
# print(json.dumps({'ok': bool(ffmpeg), 'ytDlpVersion': version, 'ffmpeg': ffmpeg or None}))
# raise SystemExit(0 if ffmpeg else 1)
