import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSourceUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getYouTubeSession, youtubeAuthForPython } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let filePath = '';
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    const format = typeof body?.format === 'string' ? body.format : 'mp3';
    const quality = Number(body?.quality || 192);
    const includeId = Boolean(body?.includeId);
    const cookieJar = await cookies();
    const cookieSessionId = cookieJar.get('audiodrop_youtube_session')?.value;
    const sessionId = cookieSessionId || (
      typeof body?.youtubeSessionId === 'string' ? body.youtubeSessionId : ''
    );
    const session = sessionId ? await getYouTubeSession(sessionId) : null;
    const result = await runYtDlp({
      action: 'download_single',
      url,
      format,
      quality,
      includeId,
      youtubeAuth: session ? youtubeAuthForPython(session) : undefined,
    }) as { filePath:string; filename:string; mime:string };
    filePath = result.filePath;
    const data = await fs.readFile(filePath);
    const filename = result.filename.replace(/[\\/]/g, '_');
    return new Response(data, {
      headers: {
        'content-type': result.mime || 'application/octet-stream',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Download failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (filePath) {
      await fs.rm(path.dirname(filePath), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
