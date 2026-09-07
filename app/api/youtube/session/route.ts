import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  createYouTubeSessionFromCookies,
  getYouTubeSession,
  releaseYouTubeSession,
  youtubeSessionCookieOptions,
} from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'audiodrop_youtube_session';

export async function GET() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return NextResponse.json({ connected: false }, { headers: { 'cache-control': 'no-store' } });

  try {
    const session = await getYouTubeSession(id);
    return NextResponse.json({
      connected: true,
      kind: session.kind,
      expiresAt: new Date(session.expiresAt).toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    const response = NextResponse.json({ connected: false }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

// Fallback path: OAuth ("Sign in with Google") is enough to list playlists,
// but yt-dlp's download-time bot-check needs a real browser cookie jar,
// which an OAuth token cannot provide. This lets the same session slot be
// filled with a cookies.txt export instead, specifically to unblock
// downloads when they fail with a "confirm you're not a bot" error.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const value = form.get('cookies');
    if (!(value instanceof File)) {
      throw new Error('Select a cookies.txt file exported from your own YouTube browser session.');
    }
    const bytes = Buffer.from(await value.arrayBuffer());
    const { sessionId, expiresAt } = await createYouTubeSessionFromCookies(bytes);

    const seconds = Math.max(60, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
    const response = NextResponse.json({ connected: true, kind: 'cookies', expiresAt }, {
      headers: { 'cache-control': 'no-store' },
    });
    response.cookies.set(SESSION_COOKIE, sessionId, youtubeSessionCookieOptions(seconds));
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create YouTube access session.' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}

export async function DELETE() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await releaseYouTubeSession(id);
  const response = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  response.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return response;
}