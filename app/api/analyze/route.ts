import { NextResponse } from 'next/server';
import { validateSourceUrl, isYouTubePlaylistUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';
import { getYouTubeSession, youtubeAuthForPython } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    const session = body?.youtubeSessionId
      ? await getYouTubeSession(body.youtubeSessionId)
      : null;

    // Private/authenticated YouTube Music playlists are resolved by ytmusicapi.
    // yt-dlp remains responsible for the actual media download.
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
