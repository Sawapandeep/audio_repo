#!/usr/bin/env python3
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    import yt_dlp
except Exception as exc:
    print(json.dumps({'error': f'yt-dlp is not installed or could not be imported: {exc}'}))
    raise SystemExit(1)

ALLOWED_FORMATS = {
    'mp3': ('audio/mpeg', True),
    'm4a': ('audio/mp4', True),
    'opus': ('audio/ogg', True),
    'wav': ('audio/wav', False),
    'flac': ('audio/flac', False),
}
BITRATES = {128, 192, 256, 320}


def clean_name(value: str, fallback='audio') -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value or '').strip().rstrip('.')
    value = re.sub(r'\s+', ' ', value)
    return (value or fallback)[:180]


def validate_format(ext):
    if ext not in ALLOWED_FORMATS:
        raise ValueError('Unsupported output format.')


def ffmpeg_ok():
    path = shutil.which('ffmpeg')
    if not path:
        raise RuntimeError('FFmpeg is required for audio conversion but was not found.')
    return path


def available_output_formats():
    ffmpeg_ok()
    enc = subprocess.run(['ffmpeg','-hide_banner','-encoders'], capture_output=True, text=True, timeout=10).stdout
    checks = {
        'mp3': 'libmp3lame' in enc or ' mp3 ' in enc,
        'm4a': any(x in enc for x in ('aac','libfdk_aac')),
        'opus': 'libopus' in enc or ' opus ' in enc,
        'wav': 'pcm_s16le' in enc,
        'flac': 'flac' in enc,
    }
    return [{'ext': ext, 'lossy': ALLOWED_FORMATS[ext][1]} for ext in ALLOWED_FORMATS if checks.get(ext)]


def base_opts():
    return {
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'nocheckcertificate': False,
        'cachedir': False,
    }


def apply_youtube_auth(opts, auth):
    if not auth:
        return opts
    cookies_path = auth.get('cookiesPath')
    if cookies_path:
        path = Path(str(cookies_path))
        if not path.is_file():
            raise RuntimeError('The temporary YouTube access session is no longer available.')
        opts['cookiefile'] = str(path)
    user_agent = auth.get('userAgent')
    if user_agent:
        opts['http_headers'] = {'User-Agent': str(user_agent)[:512]}
    return opts


def source_formats(info):
    result=[]; bitrates=set()
    for f in info.get('formats') or []:
        acodec=f.get('acodec')
        if not acodec or acodec == 'none':
            continue
        ext=f.get('ext')
        if ext:
            result.append(ext)
        abr=f.get('abr')
        if abr:
            try: bitrates.add(int(round(float(abr))))
            except Exception: pass
    unique=[]
    for x in result:
        if x not in unique: unique.append(x)
    return unique, sorted(bitrates)


def entry_url(entry):
    return entry.get('webpage_url') or entry.get('original_url') or entry.get('url')


def analyze(url, auth=None):
    formats = available_output_formats()
    # When a temporary Google session is present, use the YouTube Data API for
    # playlist metadata. This is the path that allows private playlists to be
    # enumerated without giving yt-dlp a long-lived browser cookie jar.
    if auth and ('list=' in url):
        return youtube_playlist(url, auth)

    opts = apply_youtube_auth(base_opts() | {'skip_download': True}, auth)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    is_playlist = info.get('_type') == 'playlist' or bool(info.get('entries'))
    if not is_playlist:
        src, rates = source_formats(info)
        return {
            'type':'single', 'title':info.get('title') or 'Untitled', 'thumbnail':info.get('thumbnail'),
            'uploader':info.get('uploader') or info.get('channel'), 'duration':info.get('duration'), 'url':url,
            'formats': [{'ext':x,'source':True,'lossy':x not in ('wav','flac')} for x in src],
            'sourceBitrates':rates, 'outputFormats':formats,
        }

    tracks=[]
    for idx, entry in enumerate(info.get('entries') or [], start=1):
        if not entry: continue
        u=entry_url(entry)
        if not u: continue
        # Flat playlist extraction avoids downloading the playlist. We only inspect metadata for each entry.
        tracks.append({'id':str(entry.get('id') or idx), 'title':entry.get('title') or f'Track {idx}', 'uploader':entry.get('uploader') or entry.get('channel'), 'duration':entry.get('duration'), 'url':u, 'index':idx})
    return {
        'type':'playlist', 'title':info.get('title') or 'Playlist', 'thumbnail':info.get('thumbnail'),
        'uploader':info.get('uploader') or info.get('channel'), 'url':url,
        'formats':[], 'sourceBitrates':[], 'outputFormats':formats, 'tracks':tracks,
    }


def extract_playlist_id(url):
    from urllib.parse import parse_qs, urlparse
    parsed = urlparse(url)
    playlist_id = parse_qs(parsed.query).get('list', [None])[0]
    if not playlist_id:
        raise ValueError('The YouTube Music playlist URL is missing its playlist id.')
    return str(playlist_id)

#----
import json as _json
from urllib import request as _urlreq, parse as _urlparse, error as _urlerror

YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'


def _youtube_api_get(path, params, access_token):
    query = _urlparse.urlencode(params)
    req = _urlreq.Request(f'{YOUTUBE_API_BASE}/{path}?{query}', headers={
        'Authorization': f'Bearer {access_token}',
        'Accept': 'application/json',
    })
    try:
        with _urlreq.urlopen(req, timeout=15) as resp:
            return _json.loads(resp.read().decode('utf-8'))
    except _urlerror.HTTPError as exc:
        body = exc.read().decode('utf-8', 'ignore')
        try:
            message = _json.loads(body).get('error', {}).get('message') or body
        except Exception:
            message = body
        if exc.code == 401:
            raise RuntimeError('The Google YouTube authorization expired or was revoked. Connect YouTube again.') from exc
        if exc.code == 403:
            raise RuntimeError(f'YouTube API access denied: {message}') from exc
        if exc.code == 404:
            raise RuntimeError('That playlist was not found, or is not accessible with this Google account.') from exc
        raise RuntimeError(f'YouTube API error ({exc.code}): {message}') from exc


def youtube_playlist(url, auth):
    if not auth:
        raise RuntimeError('Google YouTube authorization is required for private playlist access.')
    access_token = str(auth.get('accessToken') or '')
    if not access_token:
        raise RuntimeError('The Google YouTube OAuth token is incomplete. Connect YouTube again.')

    playlist_id = extract_playlist_id(url)
    formats = available_output_formats()

    meta = _youtube_api_get('playlists', {'part': 'snippet', 'id': playlist_id}, access_token)
    items_meta = meta.get('items') or []
    playlist_title = (items_meta[0]['snippet']['title'] if items_meta and items_meta[0].get('snippet') else 'Playlist')
    playlist_thumb = None
    if items_meta and items_meta[0].get('snippet', {}).get('thumbnails'):
        thumbs = items_meta[0]['snippet']['thumbnails']
        playlist_thumb = (thumbs.get('medium') or thumbs.get('default') or {}).get('url')

    tracks = []
    page_token = None
    idx = 0
    while True:
        params = {'part': 'snippet,contentDetails', 'playlistId': playlist_id, 'maxResults': 50}
        if page_token:
            params['pageToken'] = page_token
        page = _youtube_api_get('playlistItems', params, access_token)
        for item in page.get('items') or []:
            snippet = item.get('snippet') or {}
            content = item.get('contentDetails') or {}
            video_id = content.get('videoId') or (snippet.get('resourceId') or {}).get('videoId')
            if not video_id or snippet.get('title') in ('Deleted video', 'Private video'):
                continue
            idx += 1
            thumbs = snippet.get('thumbnails') or {}
            thumb = (thumbs.get('medium') or thumbs.get('default') or {}).get('url') if thumbs else None
            tracks.append({
                'id': str(video_id),
                'title': snippet.get('title') or f'Track {idx}',
                'uploader': snippet.get('videoOwnerChannelTitle') or snippet.get('channelTitle'),
                'duration': None,
                'url': f'https://www.youtube.com/watch?v={video_id}',
                'index': idx,
                'thumbnail': thumb,
            })
        page_token = page.get('nextPageToken')
        if not page_token:
            break

    return {
        'type': 'playlist', 'title': playlist_title, 'thumbnail': playlist_thumb,
        'uploader': None, 'duration': None, 'url': url,
        'formats': [], 'sourceBitrates': [], 'outputFormats': formats, 'tracks': tracks,
    }



def progress_hook_factory(total, emit):
    completed=0; current=''
    def hook(d):
        nonlocal completed, current
        if d.get('status') == 'finished':
            completed += 1
        current = d.get('info_dict', {}).get('title') or current
        emit({'type':'progress','completed':completed,'total':total,'current':current})
    return hook


def download_opts(output_dir, ext, quality, hook=None):
    validate_format(ext); ffmpeg_ok()
    if quality not in BITRATES: quality=192
    # yt-dlp receives a fixed, safe argument structure. No user-controlled shell command is constructed.
    post = {'key':'FFmpegExtractAudio','preferredcodec':ext}
    if ALLOWED_FORMATS[ext][1]: post['preferredquality']=str(quality)
    return base_opts() | {
        'format':'bestaudio/best',
        'outtmpl': str(Path(output_dir) / '%(title).180B [%(id)s].%(ext)s'),
        'noplaylist': True,
        'postprocessors':[post],
        'progress_hooks':[hook] if hook else [],
        'restrictfilenames': False,
        'windowsfilenames': True,
    }


def download_single(url, ext, quality, include_id=False, auth=None):
    temp=tempfile.mkdtemp(prefix='audiodrop-')
    try:
        opts=apply_youtube_auth(download_opts(temp, ext, quality), auth)
        with yt_dlp.YoutubeDL(opts) as ydl:
            info=ydl.extract_info(url, download=True)
        files=[p for p in Path(temp).iterdir() if p.is_file() and p.suffix.lower().lstrip('.') == ext]
        if not files: raise RuntimeError('yt-dlp completed but no converted audio file was produced.')
        file=files[0]
        filename=clean_name(info.get('title') or 'audio')
        if include_id:
            video_id=clean_name(str(info.get('id') or 'unknown'))
            filename=f'{filename} [{video_id}].{ext}'
        else:
            filename=f'{filename}.{ext}'
        return {'filePath':str(file),'filename':filename,'mime':ALLOWED_FORMATS[ext][0]}
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def download_playlist(payload):
    output_dir=Path(payload['outputDir']); output_dir.mkdir(parents=True,exist_ok=True)
    ext=payload['format']; quality=int(payload.get('quality') or 192)
    tracks=payload.get('tracks') or []
    auth=payload.get('youtubeAuth')
    entries=[]
    for track in tracks:
        if not isinstance(track, dict):
            continue
        u=track.get('url')
        if not u:
            continue
        entries.append({
            'id': str(track.get('id') or ''),
            'title': track.get('title') or 'Track',
            'webpage_url': u,
        })
    if not entries: raise RuntimeError('None of the selected playlist tracks could be resolved.')
    done=0; total=len(entries)
    def emit(msg):
        msg['completed']=done; msg['total']=total; print(json.dumps(msg), flush=True)
    for entry in entries:
        u=entry_url(entry)
        if not u: continue
        hook=progress_hook_factory(total, emit)
        opts=apply_youtube_auth(download_opts(str(output_dir), ext, quality, hook), auth)
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(u, download=True)
        done += 1
        emit({'type':'progress','completed':done,'total':total,'current':entry.get('title') or 'Track'})
    zip_path=output_dir / 'audio.zip'
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
        for p in output_dir.iterdir():
            if p.is_file() and p != zip_path:
                safe=clean_name(p.stem)+p.suffix
                z.write(p, arcname=safe)
    # Cleanup individual files after archive creation.
    for p in output_dir.iterdir():
        if p.is_file() and p != zip_path: p.unlink(missing_ok=True)
    print(json.dumps({'type':'result','filePath':str(zip_path)}), flush=True)


def main():
    payload=json.loads(sys.stdin.read())
    action=payload.get('action')
    if action=='ytmusic_playlist': result=ytmusic_playlist(payload['url'], payload.get('youtubeAuth')); print(json.dumps(result), flush=True); return
    if action=='analyze': result=analyze(payload['url'], payload.get('youtubeAuth')); print(json.dumps(result), flush=True); return
    if action=='download_single': result=download_single(payload['url'],payload.get('format','mp3'),int(payload.get('quality') or 192),bool(payload.get('includeId')), payload.get('youtubeAuth')); print(json.dumps(result), flush=True); return
    if action=='download_playlist': download_playlist(payload); return
    raise ValueError('Unknown action.')

try:
    main()
except Exception as exc:
    print(json.dumps({'error': str(exc)}), flush=True)
    raise SystemExit(1)
