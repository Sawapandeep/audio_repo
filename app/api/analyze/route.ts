import { NextResponse } from 'next/server';
import { validateSourceUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';
import { getYouTubeSession } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    const session = body?.youtubeSessionId
      ? await getYouTubeSession(body.youtubeSessionId)
      : null;
    const result = await runYtDlp({
      action: 'analyze',
      url,
      ...(session ? { youtubeAuth: { cookiesPath: session.cookiesPath } } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to analyze URL.';
    return NextResponse.json({error: message}, {status:400});
  }
}


