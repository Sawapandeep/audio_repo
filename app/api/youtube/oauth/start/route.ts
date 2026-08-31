import { NextResponse } from 'next/server';
import { startYouTubeOAuth } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return NextResponse.json(await startYouTubeOAuth(), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Google authorization.' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
