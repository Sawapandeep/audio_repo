import { NextResponse } from 'next/server';
import { validateSourceUrl } from '@/server/validate-url';
import { runYtDlp } from '@/server/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnalyzeResult = {
  type: 'single' | 'playlist';
  title: string;
  outputFormats?: Array<{ ext: string; lossy: boolean }>;
  tracks?: Array<{
    id: string;
    title: string;
    uploader?: string;
    duration?: number | null;
    url: string;
    index: number;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = validateSourceUrl(body?.url);
    const existingIds = new Set(
      Array.isArray(body?.existingIds) ? body.existingIds.map(String) : []
    );

    const result = (await runYtDlp({ action: 'analyze', url })) as AnalyzeResult;

    if (result.type !== 'playlist') {
      throw new Error('Sync requires a YouTube or YouTube Music playlist URL.');
    }

    const tracks = (result.tracks ?? []).map(track => ({
      ...track,
      status: (existingIds.has(String(track.id)) ? 'existing' : 'missing') as 'existing' | 'missing',
    }));
    const missingCount = tracks.filter(track => track.status === 'missing').length;

    return NextResponse.json({
      playlist: { title: result.title, url },
      total: tracks.length,
      existing: tracks.length - missingCount,
      tracks,
      outputFormats: result.outputFormats ?? [],
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to sync playlist.' },
      { status: 400 }
    );
  }
}
// import { NextResponse } from 'next/server';
// import { validateSourceUrl } from '@/server/validate-url';
// import { runYtDlp } from '@/server/runner';

// export const runtime = 'nodejs';
// export const dynamic = 'force-dynamic';

// export async function POST(request: Request) {
//   try {
//     const body = await request.json();
//     const url = validateSourceUrl(body?.url);
//     const existingIds = new Set(
//       Array.isArray(body?.existingIds) ? body.existingIds.map(String) : []
//     );

//     const result = await runYtDlp({ action: 'analyze', url }) as {
//       type: 'single' | 'playlist';
//       title: string;
//       tracks?: Array<{ id: string; title: string; uploader?: string; duration?: number | null; url: string; index: number }>;
//     };

//     if (result.type !== 'playlist') {
//       throw new Error('Sync requires a YouTube or YouTube Music playlist URL.');
//     }

//     const tracks = result.tracks ?? [];
//     const missing = tracks.filter(track => !existingIds.has(String(track.id)));

//     return NextResponse.json({
//       playlist: { title: result.title, url },
//       total: tracks.length,
//       existing: tracks.length - missing.length,
//       missing,
//       checkedAt: new Date().toISOString(),
//     });
//   } catch (error) {
//     return NextResponse.json(
//       { error: error instanceof Error ? error.message : 'Unable to sync playlist.' },
//       { status: 400 }
//     );
//   }
// }
