import { NextResponse } from 'next/server';
import { validateSourceUrl } from '@/server/validate-url';
import { createPlaylistJob } from '@/server/jobs';
import { getYouTubeSession } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    if (!Array.isArray(body?.selected) || body.selected.length === 0) throw new Error('Select at least one track.');
    const format = typeof body?.format === 'string' ? body.format : 'mp3';
    const quality = Number(body?.quality || 192);
    const session = body?.youtubeSessionId
      ? await getYouTubeSession(body.youtubeSessionId)
      : null;
    return NextResponse.json(await createPlaylistJob({
      url,
      format,
      quality,
      selected: body.selected.map(String),
      youtubeSessionId: body?.youtubeSessionId || null,
      youtubeAuth: session ? { cookiesPath: session.cookiesPath } : null,
    }));
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'Unable to start job.'},{status:400});
  }
}


