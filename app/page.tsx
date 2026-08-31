'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryHandle } from '@/app/lib/fsTypes';
import { loadDirectoryHandle, saveDirectoryHandle } from '@/app/lib/directoryStore';
import {
  loadPreferences,
  loadSyncHistory,
  recordSyncHistory,
  removeSyncHistoryEntry,
  savePreferences,
  type SyncHistoryEntry,
} from '@/app/lib/preferences';

type AudioFormat = { ext: string; source?: boolean; lossy: boolean };
type Track = { id: string; title: string; uploader?: string; duration?: number | null; url: string; index: number; thumbnail?: string | null };
type SyncTrack = Track & { status: 'existing' | 'missing' };
type LocalFile = { id: string; title: string; filename: string };
type Analysis = {
  type: 'single' | 'playlist';
  title: string;
  thumbnail?: string | null;
  uploader?: string | null;
  duration?: number | null;
  url: string;
  formats: AudioFormat[];
  sourceBitrates: number[];
  outputFormats: AudioFormat[];
  tracks?: Track[];
};
type Job = { id: string; status: 'queued'|'running'|'completed'|'failed'; progress: number; current?: string; completed: number; total: number; error?: string; downloadUrl?: string };
type ReviewData = {
  playlistTitle: string;
  playlistUrl: string;
  tracks: SyncTrack[];
  localOnly: LocalFile[];
  outputFormats: AudioFormat[];
  checkedAt: string;
};

const qualities = [128, 192, 256, 320];

function durationText(value?: number | null) {
  if (!value) return '';
  const s = Math.round(value); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

function extractVideoId(name: string) {
  const match = name.match(/\[([A-Za-z0-9_-]{6,})\]\.[^.]+$/);
  return match?.[1] || null;
}

function deriveLocalTitle(filename: string) {
  const stripped = filename.replace(/\s*\[[A-Za-z0-9_-]{6,}\]\.[^.]+$/, '');
  return stripped || filename;
}

async function downloadBlob(
  url: string,
  format: string,
  quality: number,
  youtubeSessionId?: string | null,
) {
  const res = await fetch('/api/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      format,
      quality,
      includeId: true,
      youtubeSessionId: youtubeSessionId || undefined,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed.');
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), name: match?.[1] || `audio.${format}` };
}

async function saveToDirectory(dir: DirectoryHandle, name: string, blob: Blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function verifyPermission(handle: DirectoryHandle, requestIfNeeded: boolean) {
  const mode = { mode: 'readwrite' as const };
  if (!handle.queryPermission) return true;
  const status = await handle.queryPermission(mode);
  if (status === 'granted') return true;
  if (requestIfNeeded && handle.requestPermission) {
    const requested = await handle.requestPermission(mode);
    return requested === 'granted';
  }
  return false;
}

async function scanFolder(dir: DirectoryHandle): Promise<Map<string, LocalFile>> {
  const files = new Map<string, LocalFile>();
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      const id = extractVideoId(entry.name);
      if (id) files.set(id, { id, title: deriveLocalTitle(entry.name), filename: entry.name });
    }
  }
  return files;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState(192);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null);

  const [syncUrl, setSyncUrl] = useState('');
  const [directory, setDirectory] = useState<DirectoryHandle | null>(null);
  const [storedDirectory, setStoredDirectory] = useState<DirectoryHandle | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reviewSelected, setReviewSelected] = useState<string[]>([]);
  const [downloadingReview, setDownloadingReview] = useState(false);
  const [reviewProgress, setReviewProgress] = useState({ done: 0, total: 0, current: '' });

  const [prefsReady, setPrefsReady] = useState(false);

  const [youtubeSessionId, setYoutubeSessionId] = useState<string | null>(null);
  const [youtubeSessionExpiresAt, setYoutubeSessionExpiresAt] = useState<string | null>(null);
  const [youtubeSessionBusy, setYoutubeSessionBusy] = useState(false);
  const youtubeCookieInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCount = selected.length;
  const currentFormat = useMemo(() => analysis?.outputFormats.find(x => x.ext === format), [analysis, format]);
  const reviewCurrentFormat = useMemo(
    () => reviewData?.outputFormats.find(x => x.ext === format),
    [reviewData, format]
  );

  // Load persisted preferences, sync history, and (if permission still holds)
  // the previously selected local folder, once on mount.
  useEffect(() => {
    const stored = loadPreferences();
    if (stored) { setFormat(stored.format); setQuality(stored.quality); }
    setSyncHistory(loadSyncHistory());
    (async () => {
      const handle = await loadDirectoryHandle();
      if (handle) {
        setStoredDirectory(handle);
        const granted = await verifyPermission(handle, false);
        if (granted) setDirectory(handle);
      }
      setPrefsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    savePreferences({ format, quality });
  }, [format, quality, prefsReady]);

  async function connectYouTubeFromFile(file: File) {
    setYoutubeSessionBusy(true);
    setError('');
    setSyncError('');
    try {
      const form = new FormData();
      form.set('cookies', file);
      const res = await fetch('/api/youtube/session', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to create the temporary YouTube session.');
      setYoutubeSessionId(data.sessionId);
      setYoutubeSessionExpiresAt(data.expiresAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to connect YouTube.';
      setError(message);
    } finally {
      setYoutubeSessionBusy(false);
      if (youtubeCookieInputRef.current) youtubeCookieInputRef.current.value = '';
    }
  }

  async function disconnectYouTube() {
    const id = youtubeSessionId;
    setYoutubeSessionId(null);
    setYoutubeSessionExpiresAt(null);
    if (!id) return;
    try {
      await fetch(`/api/youtube/session?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      // The server-side TTL is the safety net if the release request is interrupted.
    }
  }

  function youtubeSessionLabel() {
    if (!youtubeSessionExpiresAt) return '';
    const remaining = Math.max(0, new Date(youtubeSessionExpiresAt).getTime() - Date.now());
    const minutes = Math.ceil(remaining / 60000);
    return minutes <= 1 ? 'expires in about 1 minute' : `expires in about ${minutes} minutes`;
  }

  async function analyze(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true); setError(''); setAnalysis(null); setJob(null);
    try {
      const res = await fetch('/api/analyze', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ url, youtubeSessionId: youtubeSessionId || undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to analyze this URL.');
      setAnalysis(data);
      setFormat(data.outputFormats?.[0]?.ext || data.formats?.[0]?.ext || 'mp3');
      setQuality(192);
      setSelected((data.tracks || []).map((t: Track) => t.id));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to analyze this URL.'); }
    finally { setLoading(false); }
  }

  async function downloadSingle() {
    if (!analysis) return;
    setLoading(true); setError('');
    try {
      const { blob, name } = await downloadBlob(analysis.url, format, quality, youtubeSessionId);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      if (youtubeSessionId) await disconnectYouTube();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
      if (youtubeSessionId) await disconnectYouTube();
    }
    finally { setLoading(false); }
  }

  async function startPlaylist() {
    if (!analysis || !analysis.tracks?.length || !selectedCount) return;
    setLoading(true); setError(''); setJob(null);
    try {
      const res = await fetch('/api/jobs', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
          url: analysis.url,
          format,
          quality,
          selected,
          youtubeSessionId: youtubeSessionId || undefined,
        }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to start playlist download.');
      setJob(data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start playlist download.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`, { cache:'no-store' });
      const data = await res.json();
      setJob(data);
      if ((data.status === 'completed' || data.status === 'failed') && youtubeSessionId) {
        setYoutubeSessionId(null);
        setYoutubeSessionExpiresAt(null);
      }
    }, 800);
    return () => clearInterval(timer);
  }, [job, youtubeSessionId]);

  function toggleTrack(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function analyzeAndOpenReview(dir: DirectoryHandle, playlistUrl: string) {
    if (!playlistUrl.trim()) {
      setSyncError('Enter a YouTube or YouTube Music playlist URL.');
      return;
    }
    setSyncing(true); setSyncError('');
    try {
      const localFiles = await scanFolder(dir);
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            url: playlistUrl.trim(),
            existingIds: [...localFiles.keys()],
            youtubeSessionId: youtubeSessionId || undefined,
          }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to sync playlist.');

      const tracks = data.tracks as SyncTrack[];
      const trackIds = new Set(tracks.map(t => String(t.id)));
      const localOnly = [...localFiles.values()].filter(file => !trackIds.has(file.id));
      const outputFormats: AudioFormat[] = data.outputFormats ?? [];
      if (outputFormats.length && !outputFormats.some(f => f.ext === format)) {
        setFormat(outputFormats[0].ext);
      }

      setReviewData({
        playlistTitle: data.playlist.title,
        playlistUrl: data.playlist.url,
        tracks,
        localOnly,
        outputFormats,
        checkedAt: data.checkedAt,
      });
      setReviewSelected(tracks.filter(t => t.status === 'missing').map(t => t.id));
      setReviewOpen(true);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function pickSyncFolder() {
    setSyncError('');
    try {
      const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
      if (!picker) throw new Error('Folder access is not supported by this browser. Use a Chromium-based browser with File System Access support.');
      const handle = await picker();
      const granted = await verifyPermission(handle, true);
      if (!granted) throw new Error('Folder write permission was not granted.');
      setDirectory(handle);
      setStoredDirectory(handle);
      await saveDirectoryHandle(handle);
      if (syncUrl.trim()) await analyzeAndOpenReview(handle, syncUrl);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to select the download folder.');
    }
  }

  async function reconnectFolder() {
    if (!storedDirectory) return;
    setSyncError('');
    const granted = await verifyPermission(storedDirectory, true);
    if (granted) setDirectory(storedDirectory);
    else setSyncError('Folder permission was not granted. Choose the folder again.');
  }

  function runSyncNow() {
    if (!directory) { setSyncError('Select the folder where your audio files are stored first.'); return; }
    analyzeAndOpenReview(directory, syncUrl);
  }

  async function speedSync(entry: SyncHistoryEntry) {
    setSyncUrl(entry.url);
    let dir = directory;
    if (!dir && storedDirectory) {
      const granted = await verifyPermission(storedDirectory, true);
      if (granted) { dir = storedDirectory; setDirectory(storedDirectory); }
    }
    if (!dir) {
      setSyncError('Choose your audio folder first — SpeedSync will remember it after that.');
      return;
    }
    await analyzeAndOpenReview(dir, entry.url);
  }

  function removeHistory(historyUrl: string) {
    removeSyncHistoryEntry(historyUrl);
    setSyncHistory(loadSyncHistory());
  }

  function toggleReviewTrack(id: string) {
    setReviewSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function confirmReviewDownload() {
    if (!reviewData || !directory) return;
    const toDownload = reviewData.tracks.filter(t => t.status === 'missing' && reviewSelected.includes(t.id));
    if (!toDownload.length) { setReviewOpen(false); return; }

    setDownloadingReview(true); setSyncError('');
    setReviewProgress({ done: 0, total: toDownload.length, current: '' });
    try {
      for (let i = 0; i < toDownload.length; i++) {
        const track = toDownload[i];
        setReviewProgress({ done: i, total: toDownload.length, current: track.title });
        const { blob, name } = await downloadBlob(
          track.url,
          format,
          quality,
          youtubeSessionId,
        );
        await saveToDirectory(directory, name, blob);
        setReviewProgress({ done: i + 1, total: toDownload.length, current: track.title });
      }
      recordSyncHistory({
        title: reviewData.playlistTitle,
        url: reviewData.playlistUrl,
        lastSynced: new Date().toISOString(),
        trackCount: reviewData.tracks.length,
      });
      setSyncHistory(loadSyncHistory());
      setReviewOpen(false);
      setReviewData(null);
      if (youtubeSessionId) await disconnectYouTube();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync download failed.');
      if (youtubeSessionId) await disconnectYouTube();
    } finally {
      setDownloadingReview(false);
    }
  }

  useEffect(() => {
    if (!watchEnabled || !directory || !syncUrl.trim()) return;
    const timer = setInterval(() => {
      if (!reviewOpen && !syncing) analyzeAndOpenReview(directory, syncUrl).catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchEnabled, directory, syncUrl]);

  const missingCount = reviewData?.tracks.filter(t => t.status === 'missing').length ?? 0;
  const existingCount = reviewData?.tracks.filter(t => t.status === 'existing').length ?? 0;

  return (
    <main className="shell">
      <header className="header"><div className="brand"><div className="logo">A</div><span>AudioDrop</span></div><span className="badge">yt-dlp powered</span></header>
      <section className="hero">
        <h1>Turn YouTube links into audio.</h1>
        <p>Paste a YouTube or YouTube Music link. Analyze it first, choose a real output format and quality, then download.</p>
      </section>

      <form className="card" onSubmit={analyze}>
        <div className="inputRow"><input className="urlInput" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Paste a YouTube / YouTube Music URL" inputMode="url" autoCapitalize="none" autoCorrect="off" /><button className="primary" disabled={loading || !url.trim()}>{loading ? <><span className="spinner"/>Working</> : 'Analyze'}</button></div>
        {error && <div className="error">{error}</div>}
      </form>

      <section className="card section youtubeAccessCard">
        <div className="syncHeader">
          <div>
            <div className="syncTitle">Temporary YouTube access</div>
            <div className="syncSub">
              Needed for private playlists, age-restricted content, or YouTube sessions that require verification.
              AudioDrop never asks for your Google password.
            </div>
          </div>
          <span className="badge">{youtubeSessionId ? 'Connected' : 'Not connected'}</span>
        </div>

        {youtubeSessionId ? (
          <div className="youtubeConnected">
            <div>
              <strong>● YouTube access active</strong>
              <div className="syncNote">{youtubeSessionLabel()}. It is deleted when the task finishes or when you disconnect.</div>
            </div>
            <button type="button" className="secondary" onClick={disconnectYouTube} disabled={youtubeSessionBusy || loading || syncing || downloadingReview}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <input
              ref={youtubeCookieInputRef}
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void connectYouTubeFromFile(file);
              }}
            />
            <div className="syncActions">
              <button
                type="button"
                className="primary"
                onClick={() => youtubeCookieInputRef.current?.click()}
                disabled={youtubeSessionBusy}
              >
                {youtubeSessionBusy ? 'Connecting…' : 'Connect YouTube temporarily'}
              </button>
            </div>
            <div className="syncNote">
              Export a fresh YouTube <code>cookies.txt</code> file in Mozilla/Netscape format from your own browser session, then select it here.
              The file is stored only on the server for the temporary session and is automatically deleted after the task or the safety timeout.
            </div>
          </>
        )}
      </section>

      {analysis && <section className="card section">
        <div className="meta">
          {analysis.thumbnail ? <img className="thumb" src={analysis.thumbnail} alt="" /> : <div className="thumb" />}
          <div><div className="metaTitle">{analysis.title}</div><div className="metaSub">{analysis.uploader || 'Unknown'} {analysis.duration ? `· ${durationText(analysis.duration)}` : ''} · {analysis.type}</div></div>
        </div>

        {analysis.tracks ? <>
          <div className="playlistHeader"><strong>{analysis.tracks.length} tracks</strong><button type="button" className="secondary" onClick={()=>setSelected(selectedCount === analysis.tracks!.length ? [] : analysis.tracks!.map(t=>t.id))}>{selectedCount === analysis.tracks.length ? 'Deselect all' : 'Select all'}</button></div>
          <div className="trackList">
            {analysis.tracks.map((track, i)=><label className="track" key={track.id}><input type="checkbox" checked={selected.includes(track.id)} onChange={()=>toggleTrack(track.id)} /><span className="trackNo">{i+1}</span><span><div className="trackTitle">{track.title}</div><div className="trackMeta">{track.uploader || 'Unknown'} {track.duration ? `· ${durationText(track.duration)}` : ''}</div></span></label>)}
          </div>
        </> : null}

        <div className="controls">
          <div className="field"><label>Output format</label><select className="select" value={format} onChange={e=>setFormat(e.target.value)}>{analysis.outputFormats.map(f=><option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}{f.lossy ? ' · lossy' : ' · lossless'}</option>)}</select></div>
          <div className="field"><label>Quality</label><select className="select" value={quality} onChange={e=>setQuality(Number(e.target.value))} disabled={!currentFormat?.lossy}>{currentFormat?.lossy ? qualities.map(q=><option key={q} value={q}>{q} kbps</option>) : <option value={0}>Source / lossless</option>}</select></div>
        </div>
        {analysis.sourceBitrates.length > 0 && <div className="notice">Source audio bitrates detected: {analysis.sourceBitrates.join(', ')} kbps. Output bitrate is a conversion target, not a promise of higher source quality.</div>}

        <div className="actionBar">{analysis.type === 'single' ? <button type="button" className="primary" disabled={loading} onClick={downloadSingle}>{loading ? 'Downloading…' : `Download ${format.toUpperCase()}`}</button> : <button type="button" className="primary" disabled={loading || !selectedCount} onClick={startPlaylist}>{loading ? 'Starting…' : `Download ${selectedCount} track${selectedCount === 1 ? '' : 's'}`}</button>}<button type="button" className="secondary" onClick={()=>{setAnalysis(null);setError('');setJob(null)}}>Reset</button></div>

        {job && <div className="progress"><div className="progressTrack"><div className="progressFill" style={{width:`${job.progress}%`}} /></div><div className="progressText"><span>{job.status === 'completed' ? 'Complete' : job.status === 'failed' ? 'Failed' : job.current || job.status}</span><span>{job.completed}/{job.total}</span></div>{job.status === 'completed' && job.downloadUrl && <div className="actionBar"><a className="primary" href={job.downloadUrl}>Download ZIP</a></div>}{job.error && <div className="error">{job.error}</div>}</div>}
      </section>}

      <section className="card syncCard">
        <div className="syncHeader">
          <div>
            <div className="syncTitle">Playlist Sync</div>
            <div className="syncSub">Choose your local audio folder. AudioDrop compares YouTube video IDs in that folder with the playlist and shows you exactly what&apos;s new before downloading anything.</div>
          </div>
          <span className="badge">{directory ? directory.name : 'Folder not selected'}</span>
        </div>

        <div className="section">
          <input className="urlInput" value={syncUrl} onChange={e=>setSyncUrl(e.target.value)} placeholder="YouTube / YouTube Music playlist URL" inputMode="url" autoCapitalize="none" autoCorrect="off" />
        </div>

        <div className="syncActions">
          <button type="button" className="secondary" onClick={pickSyncFolder} disabled={syncing}>Choose audio folder</button>
          {!directory && storedDirectory && <button type="button" className="secondary" onClick={reconnectFolder} disabled={syncing}>Reconnect folder</button>}
          <button type="button" className="primary" onClick={runSyncNow} disabled={syncing || !directory || !syncUrl.trim()}>{syncing ? 'Checking…' : 'Sync now'}</button>
        </div>

        <div className="syncActions">
          <button type="button" className="secondary" onClick={()=>setWatchEnabled(v=>!v)} disabled={!directory || !syncUrl.trim()}>
            {watchEnabled ? 'Stop automatic checking' : 'Check for new songs automatically'}
          </button>
        </div>

        {syncError && <div className="error">{syncError}</div>}
        <div className="syncNote">
          Automatic checking runs only while this page is open, and always opens the Sync Review screen rather than downloading silently. A normal website cannot watch your YouTube account or write to an arbitrary folder in the background; the browser must grant folder access, and the sync design uses the YouTube video ID embedded in AudioDrop filenames to match tracks.
        </div>
      </section>

      {syncHistory.length > 0 && (
        <section className="card section">
          <div className="syncTitle">SpeedSync</div>
          <div className="syncSub">One-click access to your recent playlists — still opens Sync Review, never downloads without confirmation.</div>
          <div className="speedList">
            {syncHistory.map(entry => (
              <div className="speedCard" key={entry.url}>
                <div className="speedCardTitle">{entry.title}</div>
                <div className="speedCardMeta">{entry.trackCount} tracks · Synced {new Date(entry.lastSynced).toLocaleString()}</div>
                <div className="speedCardActions">
                  <button type="button" className="primary" onClick={()=>speedSync(entry)} disabled={syncing}>SpeedSync</button>
                  <button type="button" className="secondary" onClick={()=>removeHistory(entry.url)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {reviewOpen && reviewData && (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modalCard">
            <div className="modalHeader">
              <div>
                <div className="modalTitle">Sync Review</div>
                <div className="modalSub">{reviewData.playlistTitle} · {reviewData.tracks.length} tracks</div>
              </div>
              <button type="button" className="secondary" onClick={()=>setReviewOpen(false)} disabled={downloadingReview}>Close</button>
            </div>

            <div className="reviewSummary">
              <span className="syncPill">✓ <strong>{existingCount}</strong> already in folder</span>
              <span className="syncPill">+ <strong>{missingCount}</strong> new / missing</span>
              <span className="syncPill">− <strong>{reviewData.localOnly.length}</strong> local only</span>
            </div>

            <div className="reviewListHeader">
              <span>Tracks</span>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const missingIds = reviewData.tracks.filter(t => t.status === 'missing').map(t => t.id);
                  setReviewSelected(prev => prev.length === missingIds.length ? [] : missingIds);
                }}
              >
                {reviewSelected.length === missingCount && missingCount > 0 ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="reviewList">
              {reviewData.tracks.map(track => (
                <label key={track.id} className={`reviewTrack ${track.status === 'existing' ? 'reviewExisting' : 'reviewMissing'}`}>
                  {track.status === 'missing'
                    ? <input type="checkbox" checked={reviewSelected.includes(track.id)} onChange={()=>toggleReviewTrack(track.id)} />
                    : <span className="reviewCheckPlaceholder" aria-hidden="true" />}
                  {track.thumbnail ? <img className="reviewThumb" src={track.thumbnail} alt="" /> : <div className="reviewThumb" />}
                  <span className="reviewTrackBody">
                    <span className="reviewTrackTitle">{track.title}</span>
                    <span className="reviewTrackMeta">{track.uploader || 'Unknown'}{track.duration ? ` · ${durationText(track.duration)}` : ''}</span>
                  </span>
                  <span className={`syncPill ${track.status === 'existing' ? 'pillOk' : 'pillNew'}`}>{track.status === 'existing' ? 'Already' : 'New'}</span>
                </label>
              ))}
              {reviewData.localOnly.map(file => (
                <div key={file.id} className="reviewTrack reviewLocalOnly">
                  <span className="reviewCheckPlaceholder" aria-hidden="true" />
                  <div className="reviewThumb" />
                  <span className="reviewTrackBody">
                    <span className="reviewTrackTitle">{file.title}</span>
                    <span className="reviewTrackMeta">Not in this playlist</span>
                  </span>
                  <span className="syncPill">Local only</span>
                </div>
              ))}
            </div>

            <div className="controls">
              <div className="field"><label>Output format</label>
                <select className="select" value={format} onChange={e=>setFormat(e.target.value)}>
                  {reviewData.outputFormats.map(f => <option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}{f.lossy ? ' · lossy' : ' · lossless'}</option>)}
                </select>
              </div>
              <div className="field"><label>Quality</label>
                <select className="select" value={quality} onChange={e=>setQuality(Number(e.target.value))} disabled={!reviewCurrentFormat?.lossy}>
                  {reviewCurrentFormat?.lossy ? qualities.map(q => <option key={q} value={q}>{q} kbps</option>) : <option value={0}>Source / lossless</option>}
                </select>
              </div>
            </div>

            {downloadingReview && reviewProgress.total > 0 && (
              <div className="syncProgress">
                <div className="progressTrack"><div className="progressFill" style={{ width: `${Math.round((reviewProgress.done / reviewProgress.total) * 100)}%` }} /></div>
                <div className="progressText"><span>{reviewProgress.current || 'Preparing…'}</span><span>{reviewProgress.done}/{reviewProgress.total}</span></div>
              </div>
            )}
            {syncError && <div className="error">{syncError}</div>}

            <div className="actionBar">
              <button type="button" className="secondary" onClick={()=>setReviewOpen(false)} disabled={downloadingReview}>Cancel</button>
              <button type="button" className="primary" onClick={confirmReviewDownload} disabled={downloadingReview || !reviewSelected.length}>
                {downloadingReview ? 'Downloading…' : `Download ${reviewSelected.length} New Song${reviewSelected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">Phase 1 · Audio only · Temporary YouTube access · Playlist sync + Sync Review</footer>
    </main>
  );
}
// 'use client';

// import { FormEvent, useEffect, useMemo, useState } from 'react';
// import type { DirectoryHandle } from '@/app/lib/fsTypes';
// import { loadDirectoryHandle, saveDirectoryHandle } from '@/app/lib/directoryStore';
// import {
//   loadPreferences,
//   loadSyncHistory,
//   recordSyncHistory,
//   removeSyncHistoryEntry,
//   savePreferences,
//   type SyncHistoryEntry,
// } from '@/app/lib/preferences';

// type AudioFormat = { ext: string; source?: boolean; lossy: boolean };
// type Track = { id: string; title: string; uploader?: string; duration?: number | null; url: string; index: number };
// type SyncTrack = Track & { status: 'existing' | 'missing' };
// type LocalFile = { id: string; title: string; filename: string };
// type Analysis = {
//   type: 'single' | 'playlist';
//   title: string;
//   thumbnail?: string | null;
//   uploader?: string | null;
//   duration?: number | null;
//   url: string;
//   formats: AudioFormat[];
//   sourceBitrates: number[];
//   outputFormats: AudioFormat[];
//   tracks?: Track[];
// };
// type Job = { id: string; status: 'queued'|'running'|'completed'|'failed'; progress: number; current?: string; completed: number; total: number; error?: string; downloadUrl?: string };
// type ReviewData = {
//   playlistTitle: string;
//   playlistUrl: string;
//   tracks: SyncTrack[];
//   localOnly: LocalFile[];
//   outputFormats: AudioFormat[];
//   checkedAt: string;
// };

// const qualities = [128, 192, 256, 320];

// function durationText(value?: number | null) {
//   if (!value) return '';
//   const s = Math.round(value); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
//   return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
// }

// function extractVideoId(name: string) {
//   const match = name.match(/\[([A-Za-z0-9_-]{6,})\]\.[^.]+$/);
//   return match?.[1] || null;
// }

// function deriveLocalTitle(filename: string) {
//   const stripped = filename.replace(/\s*\[[A-Za-z0-9_-]{6,}\]\.[^.]+$/, '');
//   return stripped || filename;
// }

// async function downloadBlob(url: string, format: string, quality: number) {
//   const res = await fetch('/api/download', {
//     method: 'POST',
//     headers: { 'content-type': 'application/json' },
//     body: JSON.stringify({ url, format, quality, includeId: true }),
//   });
//   if (!res.ok) {
//     const data = await res.json().catch(() => ({}));
//     throw new Error(data.error || 'Download failed.');
//   }
//   const disposition = res.headers.get('content-disposition') || '';
//   const match = disposition.match(/filename="([^"]+)"/);
//   return { blob: await res.blob(), name: match?.[1] || `audio.${format}` };
// }

// async function saveToDirectory(dir: DirectoryHandle, name: string, blob: Blob) {
//   const handle = await dir.getFileHandle(name, { create: true });
//   const writable = await handle.createWritable();
//   await writable.write(blob);
//   await writable.close();
// }

// async function verifyPermission(handle: DirectoryHandle, requestIfNeeded: boolean) {
//   const mode = { mode: 'readwrite' as const };
//   if (!handle.queryPermission) return true;
//   const status = await handle.queryPermission(mode);
//   if (status === 'granted') return true;
//   if (requestIfNeeded && handle.requestPermission) {
//     const requested = await handle.requestPermission(mode);
//     return requested === 'granted';
//   }
//   return false;
// }

// async function scanFolder(dir: DirectoryHandle): Promise<Map<string, LocalFile>> {
//   const files = new Map<string, LocalFile>();
//   for await (const entry of dir.values()) {
//     if (entry.kind === 'file') {
//       const id = extractVideoId(entry.name);
//       if (id) files.set(id, { id, title: deriveLocalTitle(entry.name), filename: entry.name });
//     }
//   }
//   return files;
// }

// export default function Home() {
//   const [url, setUrl] = useState('');
//   const [analysis, setAnalysis] = useState<Analysis | null>(null);
//   const [format, setFormat] = useState('mp3');
//   const [quality, setQuality] = useState(192);
//   const [selected, setSelected] = useState<string[]>([]);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [job, setJob] = useState<Job | null>(null);

//   const [syncUrl, setSyncUrl] = useState('');
//   const [directory, setDirectory] = useState<DirectoryHandle | null>(null);
//   const [storedDirectory, setStoredDirectory] = useState<DirectoryHandle | null>(null);
//   const [syncing, setSyncing] = useState(false);
//   const [syncError, setSyncError] = useState('');
//   const [watchEnabled, setWatchEnabled] = useState(false);
//   const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);

//   const [reviewOpen, setReviewOpen] = useState(false);
//   const [reviewData, setReviewData] = useState<ReviewData | null>(null);
//   const [reviewSelected, setReviewSelected] = useState<string[]>([]);
//   const [downloadingReview, setDownloadingReview] = useState(false);
//   const [reviewProgress, setReviewProgress] = useState({ done: 0, total: 0, current: '' });

//   const [prefsReady, setPrefsReady] = useState(false);

//   const selectedCount = selected.length;
//   const currentFormat = useMemo(() => analysis?.outputFormats.find(x => x.ext === format), [analysis, format]);
//   const reviewCurrentFormat = useMemo(
//     () => reviewData?.outputFormats.find(x => x.ext === format),
//     [reviewData, format]
//   );

//   // Load persisted preferences, sync history, and (if permission still holds)
//   // the previously selected local folder, once on mount.
//   useEffect(() => {
//     const stored = loadPreferences();
//     if (stored) { setFormat(stored.format); setQuality(stored.quality); }
//     setSyncHistory(loadSyncHistory());
//     (async () => {
//       const handle = await loadDirectoryHandle();
//       if (handle) {
//         setStoredDirectory(handle);
//         const granted = await verifyPermission(handle, false);
//         if (granted) setDirectory(handle);
//       }
//       setPrefsReady(true);
//     })();
//   }, []);

//   useEffect(() => {
//     if (!prefsReady) return;
//     savePreferences({ format, quality });
//   }, [format, quality, prefsReady]);

//   async function analyze(e?: FormEvent) {
//     e?.preventDefault();
//     setLoading(true); setError(''); setAnalysis(null); setJob(null);
//     try {
//       const res = await fetch('/api/analyze', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ url }) });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || 'Unable to analyze this URL.');
//       setAnalysis(data);
//       setFormat(data.outputFormats?.[0]?.ext || data.formats?.[0]?.ext || 'mp3');
//       setQuality(192);
//       setSelected((data.tracks || []).map((t: Track) => t.id));
//     } catch (err) { setError(err instanceof Error ? err.message : 'Unable to analyze this URL.'); }
//     finally { setLoading(false); }
//   }

//   async function downloadSingle() {
//     if (!analysis) return;
//     setLoading(true); setError('');
//     try {
//       const { blob, name } = await downloadBlob(analysis.url, format, quality);
//       const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
//       setTimeout(() => URL.revokeObjectURL(a.href), 1000);
//     } catch (err) { setError(err instanceof Error ? err.message : 'Download failed.'); }
//     finally { setLoading(false); }
//   }

//   async function startPlaylist() {
//     if (!analysis || !analysis.tracks?.length || !selectedCount) return;
//     setLoading(true); setError(''); setJob(null);
//     try {
//       const res = await fetch('/api/jobs', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ url:analysis.url, format, quality, selected }) });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || 'Unable to start playlist download.');
//       setJob(data);
//     } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start playlist download.'); }
//     finally { setLoading(false); }
//   }

//   useEffect(() => {
//     if (!job || job.status === 'completed' || job.status === 'failed') return;
//     const timer = setInterval(async () => {
//       const res = await fetch(`/api/jobs/${job.id}`, { cache:'no-store' });
//       const data = await res.json();
//       setJob(data);
//     }, 800);
//     return () => clearInterval(timer);
//   }, [job]);

//   function toggleTrack(id: string) {
//     setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
//   }

//   async function analyzeAndOpenReview(dir: DirectoryHandle, playlistUrl: string) {
//     if (!playlistUrl.trim()) {
//       setSyncError('Enter a YouTube or YouTube Music playlist URL.');
//       return;
//     }
//     setSyncing(true); setSyncError('');
//     try {
//       const localFiles = await scanFolder(dir);
//       const res = await fetch('/api/sync', {
//         method: 'POST',
//         headers: { 'content-type': 'application/json' },
//         body: JSON.stringify({ url: playlistUrl.trim(), existingIds: [...localFiles.keys()] }),
//       });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || 'Unable to sync playlist.');

//       const tracks = data.tracks as SyncTrack[];
//       const trackIds = new Set(tracks.map(t => String(t.id)));
//       const localOnly = [...localFiles.values()].filter(file => !trackIds.has(file.id));
//       const outputFormats: AudioFormat[] = data.outputFormats ?? [];
//       if (outputFormats.length && !outputFormats.some(f => f.ext === format)) {
//         setFormat(outputFormats[0].ext);
//       }

//       setReviewData({
//         playlistTitle: data.playlist.title,
//         playlistUrl: data.playlist.url,
//         tracks,
//         localOnly,
//         outputFormats,
//         checkedAt: data.checkedAt,
//       });
//       setReviewSelected(tracks.filter(t => t.status === 'missing').map(t => t.id));
//       setReviewOpen(true);
//     } catch (err) {
//       setSyncError(err instanceof Error ? err.message : 'Sync failed.');
//     } finally {
//       setSyncing(false);
//     }
//   }

//   async function pickSyncFolder() {
//     setSyncError('');
//     try {
//       const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
//       if (!picker) throw new Error('Folder access is not supported by this browser. Use a Chromium-based browser with File System Access support.');
//       const handle = await picker();
//       const granted = await verifyPermission(handle, true);
//       if (!granted) throw new Error('Folder write permission was not granted.');
//       setDirectory(handle);
//       setStoredDirectory(handle);
//       await saveDirectoryHandle(handle);
//       if (syncUrl.trim()) await analyzeAndOpenReview(handle, syncUrl);
//     } catch (err) {
//       setSyncError(err instanceof Error ? err.message : 'Unable to select the download folder.');
//     }
//   }

//   async function reconnectFolder() {
//     if (!storedDirectory) return;
//     setSyncError('');
//     const granted = await verifyPermission(storedDirectory, true);
//     if (granted) setDirectory(storedDirectory);
//     else setSyncError('Folder permission was not granted. Choose the folder again.');
//   }

//   function runSyncNow() {
//     if (!directory) { setSyncError('Select the folder where your audio files are stored first.'); return; }
//     analyzeAndOpenReview(directory, syncUrl);
//   }

//   async function speedSync(entry: SyncHistoryEntry) {
//     setSyncUrl(entry.url);
//     let dir = directory;
//     if (!dir && storedDirectory) {
//       const granted = await verifyPermission(storedDirectory, true);
//       if (granted) { dir = storedDirectory; setDirectory(storedDirectory); }
//     }
//     if (!dir) {
//       setSyncError('Choose your audio folder first — SpeedSync will remember it after that.');
//       return;
//     }
//     await analyzeAndOpenReview(dir, entry.url);
//   }

//   function removeHistory(historyUrl: string) {
//     removeSyncHistoryEntry(historyUrl);
//     setSyncHistory(loadSyncHistory());
//   }

//   function toggleReviewTrack(id: string) {
//     setReviewSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
//   }

//   async function confirmReviewDownload() {
//     if (!reviewData || !directory) return;
//     const toDownload = reviewData.tracks.filter(t => t.status === 'missing' && reviewSelected.includes(t.id));
//     if (!toDownload.length) { setReviewOpen(false); return; }

//     setDownloadingReview(true); setSyncError('');
//     setReviewProgress({ done: 0, total: toDownload.length, current: '' });
//     try {
//       for (let i = 0; i < toDownload.length; i++) {
//         const track = toDownload[i];
//         setReviewProgress({ done: i, total: toDownload.length, current: track.title });
//         const { blob, name } = await downloadBlob(track.url, format, quality);
//         await saveToDirectory(directory, name, blob);
//         setReviewProgress({ done: i + 1, total: toDownload.length, current: track.title });
//       }
//       recordSyncHistory({
//         title: reviewData.playlistTitle,
//         url: reviewData.playlistUrl,
//         lastSynced: new Date().toISOString(),
//         trackCount: reviewData.tracks.length,
//       });
//       setSyncHistory(loadSyncHistory());
//       setReviewOpen(false);
//       setReviewData(null);
//     } catch (err) {
//       setSyncError(err instanceof Error ? err.message : 'Sync download failed.');
//     } finally {
//       setDownloadingReview(false);
//     }
//   }

//   useEffect(() => {
//     if (!watchEnabled || !directory || !syncUrl.trim()) return;
//     const timer = setInterval(() => {
//       if (!reviewOpen && !syncing) analyzeAndOpenReview(directory, syncUrl).catch(() => undefined);
//     }, 5 * 60 * 1000);
//     return () => clearInterval(timer);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [watchEnabled, directory, syncUrl]);

//   const missingCount = reviewData?.tracks.filter(t => t.status === 'missing').length ?? 0;
//   const existingCount = reviewData?.tracks.filter(t => t.status === 'existing').length ?? 0;

//   return (
//     <main className="shell">
//       <header className="header"><div className="brand"><div className="logo">A</div><span>AudioDrop</span></div><span className="badge">yt-dlp powered</span></header>
//       <section className="hero">
//         <h1>Turn YouTube links into audio.</h1>
//         <p>Paste a YouTube or YouTube Music link. Analyze it first, choose a real output format and quality, then download.</p>
//       </section>

//       <form className="card" onSubmit={analyze}>
//         <div className="inputRow"><input className="urlInput" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Paste a YouTube / YouTube Music URL" inputMode="url" autoCapitalize="none" autoCorrect="off" /><button className="primary" disabled={loading || !url.trim()}>{loading ? <><span className="spinner"/>Working</> : 'Analyze'}</button></div>
//         {error && <div className="error">{error}</div>}
//       </form>

//       {analysis && <section className="card section">
//         <div className="meta">
//           {analysis.thumbnail ? <img className="thumb" src={analysis.thumbnail} alt="" /> : <div className="thumb" />}
//           <div><div className="metaTitle">{analysis.title}</div><div className="metaSub">{analysis.uploader || 'Unknown'} {analysis.duration ? `· ${durationText(analysis.duration)}` : ''} · {analysis.type}</div></div>
//         </div>

//         {analysis.tracks ? <>
//           <div className="playlistHeader"><strong>{analysis.tracks.length} tracks</strong><button type="button" className="secondary" onClick={()=>setSelected(selectedCount === analysis.tracks!.length ? [] : analysis.tracks!.map(t=>t.id))}>{selectedCount === analysis.tracks.length ? 'Deselect all' : 'Select all'}</button></div>
//           <div className="trackList">
//             {analysis.tracks.map((track, i)=><label className="track" key={track.id}><input type="checkbox" checked={selected.includes(track.id)} onChange={()=>toggleTrack(track.id)} /><span className="trackNo">{i+1}</span><span><div className="trackTitle">{track.title}</div><div className="trackMeta">{track.uploader || 'Unknown'} {track.duration ? `· ${durationText(track.duration)}` : ''}</div></span></label>)}
//           </div>
//         </> : null}

//         <div className="controls">
//           <div className="field"><label>Output format</label><select className="select" value={format} onChange={e=>setFormat(e.target.value)}>{analysis.outputFormats.map(f=><option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}{f.lossy ? ' · lossy' : ' · lossless'}</option>)}</select></div>
//           <div className="field"><label>Quality</label><select className="select" value={quality} onChange={e=>setQuality(Number(e.target.value))} disabled={!currentFormat?.lossy}>{currentFormat?.lossy ? qualities.map(q=><option key={q} value={q}>{q} kbps</option>) : <option value={0}>Source / lossless</option>}</select></div>
//         </div>
//         {analysis.sourceBitrates.length > 0 && <div className="notice">Source audio bitrates detected: {analysis.sourceBitrates.join(', ')} kbps. Output bitrate is a conversion target, not a promise of higher source quality.</div>}

//         <div className="actionBar">{analysis.type === 'single' ? <button type="button" className="primary" disabled={loading} onClick={downloadSingle}>{loading ? 'Downloading…' : `Download ${format.toUpperCase()}`}</button> : <button type="button" className="primary" disabled={loading || !selectedCount} onClick={startPlaylist}>{loading ? 'Starting…' : `Download ${selectedCount} track${selectedCount === 1 ? '' : 's'}`}</button>}<button type="button" className="secondary" onClick={()=>{setAnalysis(null);setError('');setJob(null)}}>Reset</button></div>

//         {job && <div className="progress"><div className="progressTrack"><div className="progressFill" style={{width:`${job.progress}%`}} /></div><div className="progressText"><span>{job.status === 'completed' ? 'Complete' : job.status === 'failed' ? 'Failed' : job.current || job.status}</span><span>{job.completed}/{job.total}</span></div>{job.status === 'completed' && job.downloadUrl && <div className="actionBar"><a className="primary" href={job.downloadUrl}>Download ZIP</a></div>}{job.error && <div className="error">{job.error}</div>}</div>}
//       </section>}

//       <section className="card syncCard">
//         <div className="syncHeader">
//           <div>
//             <div className="syncTitle">Playlist Sync</div>
//             <div className="syncSub">Choose your local audio folder. AudioDrop compares YouTube video IDs in that folder with the playlist and shows you exactly what&apos;s new before downloading anything.</div>
//           </div>
//           <span className="badge">{directory ? directory.name : 'Folder not selected'}</span>
//         </div>

//         <div className="section">
//           <input className="urlInput" value={syncUrl} onChange={e=>setSyncUrl(e.target.value)} placeholder="YouTube / YouTube Music playlist URL" inputMode="url" autoCapitalize="none" autoCorrect="off" />
//         </div>

//         <div className="syncActions">
//           <button type="button" className="secondary" onClick={pickSyncFolder} disabled={syncing}>Choose audio folder</button>
//           {!directory && storedDirectory && <button type="button" className="secondary" onClick={reconnectFolder} disabled={syncing}>Reconnect folder</button>}
//           <button type="button" className="primary" onClick={runSyncNow} disabled={syncing || !directory || !syncUrl.trim()}>{syncing ? 'Checking…' : 'Sync now'}</button>
//         </div>

//         <div className="syncActions">
//           <button type="button" className="secondary" onClick={()=>setWatchEnabled(v=>!v)} disabled={!directory || !syncUrl.trim()}>
//             {watchEnabled ? 'Stop automatic checking' : 'Check for new songs automatically'}
//           </button>
//         </div>

//         {syncError && <div className="error">{syncError}</div>}
//         <div className="syncNote">
//           Automatic checking runs only while this page is open, and always opens the Sync Review screen rather than downloading silently. A normal website cannot watch your YouTube account or write to an arbitrary folder in the background; the browser must grant folder access, and the sync design uses the YouTube video ID embedded in AudioDrop filenames to match tracks.
//         </div>
//       </section>

//       {syncHistory.length > 0 && (
//         <section className="card section">
//           <div className="syncTitle">SpeedSync</div>
//           <div className="syncSub">One-click access to your recent playlists — still opens Sync Review, never downloads without confirmation.</div>
//           <div className="speedList">
//             {syncHistory.map(entry => (
//               <div className="speedCard" key={entry.url}>
//                 <div className="speedCardTitle">{entry.title}</div>
//                 <div className="speedCardMeta">{entry.trackCount} tracks · Synced {new Date(entry.lastSynced).toLocaleString()}</div>
//                 <div className="speedCardActions">
//                   <button type="button" className="primary" onClick={()=>speedSync(entry)} disabled={syncing}>SpeedSync</button>
//                   <button type="button" className="secondary" onClick={()=>removeHistory(entry.url)}>Remove</button>
//                 </div>
//               </div>
//             ))}
//           </div>
//         </section>
//       )}

//       {reviewOpen && reviewData && (
//         <div className="modalOverlay" role="dialog" aria-modal="true">
//           <div className="modalCard">
//             <div className="modalHeader">
//               <div>
//                 <div className="modalTitle">Sync Review</div>
//                 <div className="modalSub">{reviewData.playlistTitle} · {reviewData.tracks.length} tracks</div>
//               </div>
//               <button type="button" className="secondary" onClick={()=>setReviewOpen(false)} disabled={downloadingReview}>Close</button>
//             </div>

//             <div className="reviewSummary">
//               <span className="syncPill">✓ <strong>{existingCount}</strong> already in folder</span>
//               <span className="syncPill">+ <strong>{missingCount}</strong> new / missing</span>
//               <span className="syncPill">− <strong>{reviewData.localOnly.length}</strong> local only</span>
//             </div>

//             <div className="reviewListHeader">
//               <span>Tracks</span>
//               <button
//                 type="button"
//                 className="secondary"
//                 onClick={() => {
//                   const missingIds = reviewData.tracks.filter(t => t.status === 'missing').map(t => t.id);
//                   setReviewSelected(prev => prev.length === missingIds.length ? [] : missingIds);
//                 }}
//               >
//                 {reviewSelected.length === missingCount && missingCount > 0 ? 'Deselect all' : 'Select all'}
//               </button>
//             </div>

//             <div className="reviewList">
//               {reviewData.tracks.map(track => (
//                 <label key={track.id} className={`reviewTrack ${track.status === 'existing' ? 'reviewExisting' : 'reviewMissing'}`}>
//                   {track.status === 'missing'
//                     ? <input type="checkbox" checked={reviewSelected.includes(track.id)} onChange={()=>toggleReviewTrack(track.id)} />
//                     : <span className="reviewCheckPlaceholder" aria-hidden="true" />}
//                   <span className="reviewTrackBody">
//                     <span className="reviewTrackTitle">{track.title}</span>
//                     <span className="reviewTrackMeta">{track.uploader || 'Unknown'}</span>
//                   </span>
//                   <span className={`syncPill ${track.status === 'existing' ? 'pillOk' : 'pillNew'}`}>{track.status === 'existing' ? 'Already' : 'New'}</span>
//                 </label>
//               ))}
//               {reviewData.localOnly.map(file => (
//                 <div key={file.id} className="reviewTrack reviewLocalOnly">
//                   <span className="reviewCheckPlaceholder" aria-hidden="true" />
//                   <span className="reviewTrackBody">
//                     <span className="reviewTrackTitle">{file.title}</span>
//                     <span className="reviewTrackMeta">Not in this playlist</span>
//                   </span>
//                   <span className="syncPill">Local only</span>
//                 </div>
//               ))}
//             </div>

//             <div className="controls">
//               <div className="field"><label>Output format</label>
//                 <select className="select" value={format} onChange={e=>setFormat(e.target.value)}>
//                   {reviewData.outputFormats.map(f => <option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}{f.lossy ? ' · lossy' : ' · lossless'}</option>)}
//                 </select>
//               </div>
//               <div className="field"><label>Quality</label>
//                 <select className="select" value={quality} onChange={e=>setQuality(Number(e.target.value))} disabled={!reviewCurrentFormat?.lossy}>
//                   {reviewCurrentFormat?.lossy ? qualities.map(q => <option key={q} value={q}>{q} kbps</option>) : <option value={0}>Source / lossless</option>}
//                 </select>
//               </div>
//             </div>

//             {downloadingReview && reviewProgress.total > 0 && (
//               <div className="syncProgress">
//                 <div className="progressTrack"><div className="progressFill" style={{ width: `${Math.round((reviewProgress.done / reviewProgress.total) * 100)}%` }} /></div>
//                 <div className="progressText"><span>{reviewProgress.current || 'Preparing…'}</span><span>{reviewProgress.done}/{reviewProgress.total}</span></div>
//               </div>
//             )}
//             {syncError && <div className="error">{syncError}</div>}

//             <div className="actionBar">
//               <button type="button" className="secondary" onClick={()=>setReviewOpen(false)} disabled={downloadingReview}>Cancel</button>
//               <button type="button" className="primary" onClick={confirmReviewDownload} disabled={downloadingReview || !reviewSelected.length}>
//                 {downloadingReview ? 'Downloading…' : `Download ${reviewSelected.length} New Song${reviewSelected.length === 1 ? '' : 's'}`}
//               </button>
//             </div>
//           </div>
//         </div>
//       )}

//       <footer className="footer">Phase 1 · Audio only · No accounts, database or cloud storage · Playlist sync + Sync Review added</footer>
//     </main>
//   );
// }

