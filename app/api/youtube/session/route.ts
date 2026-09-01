import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getYouTubeSession, releaseYouTubeSession } from '@/server/youtube-session';

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
      expiresAt: new Date(session.expiresAt).toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    const response = NextResponse.json({ connected: false }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.delete(SESSION_COOKIE);
    return response;
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
