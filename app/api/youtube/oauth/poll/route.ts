import { NextResponse } from 'next/server';
import { completeYouTubeOAuth } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const deviceCode = typeof body?.deviceCode === 'string' ? body.deviceCode.trim() : '';
    if (!deviceCode) throw new Error('The Google device authorization code is missing.');

    try {
      const result = await completeYouTubeOAuth(deviceCode);
      return NextResponse.json({ status: 'authorized', ...result }, {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authorization is still pending.';
      if (/authorization_pending|slow_down/i.test(message)) {
        return NextResponse.json({ status: 'pending' }, {
          headers: { 'cache-control': 'no-store' },
        });
      }
      return NextResponse.json({ status: 'error', error: message }, {
        status: 400,
        headers: { 'cache-control': 'no-store' },
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to poll Google authorization.' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
