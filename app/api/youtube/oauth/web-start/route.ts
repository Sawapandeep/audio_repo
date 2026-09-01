import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildYouTubeAuthUrl } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    const response = NextResponse.redirect(buildYouTubeAuthUrl(state));
    response.cookies.set('audiodrop_oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start Google authorization.';
    const response = NextResponse.redirect(new URL(`/?yt_error=${encodeURIComponent(message)}`, process.env.APP_ORIGIN || 'https://audio-repo.onrender.com'));
    return response;
  }
}
