import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { runYtDlp } from '@/server/runner';
import {
  getYouTubeSession,
  youtubeAuthForPython,
} from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cookieJar = await cookies();
    const sessionId = cookieJar.get(
      'audiodrop_youtube_session'
    )?.value;

    if (!sessionId) {
      throw new Error(
        'Connect YouTube with Google before fetching your playlists.'
      );
    }

    const session = await getYouTubeSession(sessionId);

    const result = await runYtDlp({
      action: 'youtube_playlists',
      youtubeAuth: youtubeAuthForPython(session),
    });

    return NextResponse.json(result, {
      headers: {
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to fetch your YouTube playlists.',
      },
      {
        status: 400,
        headers: {
          'cache-control': 'no-store',
        },
      }
    );
  }
}