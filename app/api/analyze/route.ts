import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSourceUrl, isYouTubePlaylistUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';
import { getYouTubeSession, youtubeAuthForPython } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    const cookieJar = await cookies();
    const cookieSessionId = cookieJar.get('audiodrop_youtube_session')?.value;
    const sessionId = cookieSessionId || (
      typeof body?.youtubeSessionId === 'string' ? body.youtubeSessionId : ''
    );
    const session = sessionId ? await getYouTubeSession(sessionId) : null;

    // Authenticated playlist metadata is resolved through the YouTube Data API.
    // yt-dlp remains responsible for actual media extraction/download.
    if (session && isYouTubePlaylistUrl(url)) {
      const result = await runYtDlp({
        action: 'ytmusic_playlist',
        url,
        youtubeAuth: youtubeAuthForPython(session),
      });
      return NextResponse.json(result);
    }

    const result = await runYtDlp({ action: 'analyze', url });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to analyze URL.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
