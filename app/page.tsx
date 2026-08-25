'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type AudioFormat = { ext: string; source?: boolean; lossy: boolean };
type Track = { id: string; title: string; uploader?: string; duration?: number | null; url: string; index: number };
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
type SyncResult = {
  playlist: { title: string; url: string };
  total: number;
  existing: number;
  missing: Track[];
  checkedAt: string;
};

type DirectoryFileHandle = {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
};
type DirectoryHandle = {
  kind: 'directory';
  name: string;
  queryPermission?(options?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  values(): AsyncIterableIterator<DirectoryFileHandle | DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<DirectoryFileHandle>;
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

async function downloadBlob(url: string, format: string, quality: number) {
  const res = await fetch('/api/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, format, quality, includeId: true }),
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
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0, current: '' });
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [syncError, setSyncError] = useState('');

  const selectedCount = selected.length;
  const currentFormat = useMemo(() => analysis?.outputFormats.find(x => x.ext === format), [analysis, format]);

  async function analyze(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true); setError(''); setAnalysis(null); setJob(null);
    try {
      const res = await fetch('/api/analyze', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ url }) });
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
      const { blob, name } = await downloadBlob(analysis.url, format, quality);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Download failed.'); }
    finally { setLoading(false); }
  }

  async function startPlaylist() {
    if (!analysis || !analysis.tracks?.length || !selectedCount) return;
    setLoading(true); setError(''); setJob(null);
    try {
      const res = await fetch('/api/jobs', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ url:analysis.url, format, quality, selected }) });
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
    }, 800);
    return () => clearInterval(timer);
  }, [job]);

  function toggleTrack(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function pickSyncFolder() {
    setSyncError('');
    try {
      const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
      if (!picker) throw new Error('Folder access is not supported by this browser. Use a Chromium-based browser with File System Access support.');
      const handle = await picker();
      if (handle.requestPermission) {
        const permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') throw new Error('Folder write permission was not granted.');
      }
      setDirectory(handle);
      await runSync(handle, true);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to select the download folder.');
    }
  }

  async function scanFolder(dir: DirectoryHandle) {
    const ids = new Set<string>();
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        const id = extractVideoId(entry.name);
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  async function runSync(dir = directory, promptUser = true) {
    if (!dir) {
      setSyncError('Select the folder where your audio files are stored first.');
      return;
    }
    if (!syncUrl.trim()) {
      setSyncError('Enter a YouTube or YouTube Music playlist URL.');
      return;
    }

    setSyncing(true); setSyncError('');
    try {
      const existingIds = await scanFolder(dir);
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: syncUrl.trim(), existingIds: [...existingIds] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to sync playlist.');
      const result = data as SyncResult;
      setSyncResult(result);

      if (!result.missing.length) return;

      if (promptUser && !window.confirm(
        `${result.missing.length} new track${result.missing.length === 1 ? '' : 's'} found in "${result.playlist.title}". Download them now?`
      )) return;

      setSyncProgress({ done: 0, total: result.missing.length, current: '' });
      for (let i = 0; i < result.missing.length; i++) {
        const track = result.missing[i];
        setSyncProgress({ done: i, total: result.missing.length, current: track.title });
        const { blob, name } = await downloadBlob(track.url, format, quality);
        await saveToDirectory(dir, name, blob);
        setSyncProgress({ done: i + 1, total: result.missing.length, current: track.title });
      }

      const refreshedIds = await scanFolder(dir);
      setSyncResult({ ...result, existing: refreshedIds.size, missing: result.missing.filter(t => !refreshedIds.has(String(t.id))) });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!watchEnabled || !directory || !syncUrl.trim()) return;
    const timer = setInterval(() => {
      runSync(directory, true).catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [watchEnabled, directory, syncUrl, format, quality]);

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
            <div className="syncSub">Choose your local audio folder. AudioDrop compares YouTube video IDs in that folder with the playlist and downloads only missing tracks.</div>
          </div>
          <span className="badge">{directory ? directory.name : 'Folder not selected'}</span>
        </div>

        <div className="section">
          <input className="urlInput" value={syncUrl} onChange={e=>setSyncUrl(e.target.value)} placeholder="YouTube / YouTube Music playlist URL" inputMode="url" autoCapitalize="none" autoCorrect="off" />
        </div>

        <div className="syncActions">
          <button type="button" className="secondary" onClick={pickSyncFolder} disabled={syncing}>Choose audio folder</button>
          <button type="button" className="primary" onClick={()=>runSync()} disabled={syncing || !directory || !syncUrl.trim()}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </div>

        <div className="syncActions">
          <button type="button" className="secondary" onClick={()=>setWatchEnabled(v=>!v)} disabled={!directory || !syncUrl.trim()}>
            {watchEnabled ? 'Stop automatic checking' : 'Check for new songs automatically'}
          </button>
        </div>

        {syncResult && <div className="syncStatus">
          <span className="syncPill"><strong>{syncResult.playlist.title}</strong></span>
          <span className="syncPill"><strong>{syncResult.existing}</strong> present</span>
          <span className="syncPill"><strong>{syncResult.missing.length}</strong> missing</span>
        </div>}

        {syncResult?.missing.length ? <div className="syncMissing">
          {syncResult.missing.map(track => <div className="syncTrack" key={track.id}><div><div className="syncTrackTitle">{track.title}</div><div className="syncTrackMeta">{track.uploader || 'Unknown'} · ID {track.id}</div></div><span className="syncPill">Missing</span></div>)}
        </div> : null}

        {syncing && syncProgress.total > 0 && <div className="syncProgress"><div className="progressTrack"><div className="progressFill" style={{width:`${Math.round((syncProgress.done/syncProgress.total)*100)}%`}} /></div><div className="progressText"><span>{syncProgress.current || 'Preparing…'}</span><span>{syncProgress.done}/{syncProgress.total}</span></div></div>}
        {syncError && <div className="error">{syncError}</div>}
        <div className="syncNote">
          Automatic checking runs only while this page is open. A normal website cannot silently monitor your YouTube account or write to an arbitrary folder; the browser must grant folder access. The sync design therefore uses the playlist URL plus the video ID embedded in AudioDrop filenames.
        </div>
      </section>

      <footer className="footer">Phase 1 · Audio only · No accounts, database or cloud storage · Playlist sync added</footer>
    </main>
  );
}
