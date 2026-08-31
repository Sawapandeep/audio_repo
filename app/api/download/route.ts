import { NextResponse } from 'next/server';
import { validateSourceUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';
// import { getYouTubeSession } from '@/server/youtube-session';
import { getYouTubeSession } from '@/server/youtube-session';
import fs from 'node:fs/promises';
import path from 'node:path';

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
    const session = body?.youtubeSessionId
      ? await getYouTubeSession(body.youtubeSessionId)
      : null;
    const result = await runYtDlp({
      action: 'download_single',
      url,
      format,
      quality,
      includeId,
      ...(session ? { youtubeAuth: { cookiesPath: session.cookiesPath } } : {}),
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


