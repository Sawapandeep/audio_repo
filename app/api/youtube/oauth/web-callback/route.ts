import { NextResponse } from 'next/server';
import { completeYouTubeOAuthWebFlow } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookieState = request.headers.get('cookie')?.match(/audiodrop_oauth_state=([^;]+)/)?.[1];

  function redirectHome(params: Record<string, string>) {
    const target = new URL('/', url.origin);
    Object.entries(params).forEach(([k, v]) => target.searchParams.set(k, v));
    const response = NextResponse.redirect(target);
    response.cookies.delete('audiodrop_oauth_state');
    return response;
  }

  if (error) return redirectHome({ yt_error: error });
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectHome({ yt_error: 'invalid_state' });
  }

  try {
    const { sessionId, expiresAt } = await completeYouTubeOAuthWebFlow(code);
    return redirectHome({ yt_session: sessionId, yt_expires: expiresAt });
  } catch (err) {
    return redirectHome({ yt_error: err instanceof Error ? err.message : 'oauth_failed' });
  }
}