import { NextResponse } from 'next/server';
import { releaseYouTubeSession } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  await releaseYouTubeSession(url.searchParams.get('id'));
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  });
}
