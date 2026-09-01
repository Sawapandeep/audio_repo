import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSourceUrl, isYouTubePlaylistUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';
import { getYouTubeSession, youtubeAuthForPython } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnalyzeResult = {
  type: 'single' | 'playlist';
  title: string;
  outputFormats?: Array<{ ext: string; lossy: boolean }>;
  tracks?: Array<{
    id: string;
    title: string;
    uploader?: string;
    duration?: number | null;
    url: string;
    index: number;
    thumbnail?: string | null;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    const existingIds = new Set(
      Array.isArray(body?.existingIds) ? body.existingIds.map(String) : []
    );
    const cookieJar = await cookies();
    const cookieSessionId = cookieJar.get('audiodrop_youtube_session')?.value;
    const sessionId = cookieSessionId || (
      typeof body?.youtubeSessionId === 'string' ? body.youtubeSessionId : ''
    );
    const session = sessionId ? await getYouTubeSession(sessionId) : null;

    if (!session) {
      throw new Error('Connect YouTube with Google before syncing a YouTube Music playlist.');
    }
    if (!isYouTubePlaylistUrl(url)) {
      throw new Error('Sync requires a YouTube or YouTube Music playlist URL.');
    }

    const result = (await runYtDlp({
      action: 'ytmusic_playlist',
      url,
      youtubeAuth: youtubeAuthForPython(session),
    })) as AnalyzeResult;

    const tracks = (result.tracks ?? []).map(track => ({
      ...track,
      status: (existingIds.has(String(track.id)) ? 'existing' : 'missing') as 'existing' | 'missing',
    }));
    const missingCount = tracks.filter(track => track.status === 'missing').length;

    return NextResponse.json({
      playlist: { title: result.title, url },
      total: tracks.length,
      existing: tracks.length - missingCount,
      tracks,
      outputFormats: result.outputFormats ?? [],
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to sync playlist.' },
      { status: 400 }
    );
  }
}
