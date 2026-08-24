import { NextResponse } from 'next/server';
import { validateSourceUrl } from '@/server/validate-url';
import { createPlaylistJob } from '@/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    if (!Array.isArray(body?.selected) || body.selected.length === 0) throw new Error('Select at least one track.');
    const format = typeof body?.format === 'string' ? body.format : 'mp3';
    const quality = Number(body?.quality || 192);
    return NextResponse.json(await createPlaylistJob({url, format, quality, selected:body.selected.map(String)}));
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'Unable to start job.'},{status:400});
  }
}
