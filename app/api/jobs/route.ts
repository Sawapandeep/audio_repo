import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSourceUrl } from '@/server/validate-url';
import { createPlaylistJob, type JobTrack } from '@/server/jobs';
import { getYouTubeSession } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    if (!Array.isArray(body?.selected) || body.selected.length === 0) throw new Error('Select at least one track.');
    if (!Array.isArray(body?.tracks) || body.tracks.length === 0) throw new Error('No playlist tracks were supplied. Analyze the playlist again.');

    const selected = new Set(body.selected.map(String));
    const tracks: JobTrack[] = body.tracks
      .filter((track: any) => track && selected.has(String(track.id)) && typeof track.url === 'string')
      .map((track: any) => ({
        id: String(track.id),
        title: typeof track.title === 'string' ? track.title : 'Track',
        url: String(track.url),
      }));
    if (!tracks.length) throw new Error('None of the selected playlist tracks could be resolved.');

    const format = typeof body?.format === 'string' ? body.format : 'mp3';
    const quality = Number(body?.quality || 192);
    const cookieJar = await cookies();
    const cookieSessionId = cookieJar.get('audiodrop_youtube_session')?.value;
    const sessionId = cookieSessionId || (
      typeof body?.youtubeSessionId === 'string' ? body.youtubeSessionId : ''
    );
    const session = sessionId ? await getYouTubeSession(sessionId) : null;

    return NextResponse.json(await createPlaylistJob({
      url,
      format,
      quality,
      selected: tracks.map(track => track.id),
      tracks,
      youtubeSessionId: session ? session.id : null,
    }));
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'Unable to start job.'},{status:400});
  }
}
