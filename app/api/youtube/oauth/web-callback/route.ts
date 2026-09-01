import { NextResponse } from 'next/server';
import { completeYouTubeOAuthWebFlow, youtubeSessionCookieOptions } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookieState = request.headers.get('cookie')?.match(/(?:^|;\s*)audiodrop_oauth_state=([^;]+)/)?.[1];
  const origin = url.origin;

  function redirectHome(params: Record<string, string>) {
    const target = new URL('/', origin);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    const response = NextResponse.redirect(target);
    response.cookies.delete('audiodrop_oauth_state');
    return response;
  }

  if (error) return redirectHome({ yt_error: error });
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectHome({ yt_error: 'Google OAuth state validation failed. Please try connecting again.' });
  }

  try {
    const { sessionId, expiresAt } = await completeYouTubeOAuthWebFlow(code);
    const response = redirectHome({ yt_connected: '1' });
    const seconds = Math.max(60, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
    response.cookies.set('audiodrop_youtube_session', sessionId, youtubeSessionCookieOptions(seconds));
    return response;
  } catch (err) {
    return redirectHome({ yt_error: err instanceof Error ? err.message : 'Google authorization failed.' });
  }
}
