import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { buildYouTubeAuthUrl } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildYouTubeAuthUrl(state));
  response.cookies.set('audiodrop_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 600,
    path: '/',
  });
  return response;
}