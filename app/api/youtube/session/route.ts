import { NextResponse } from 'next/server';
import { createYouTubeSession, releaseYouTubeSession } from '@/server/youtube-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const value = form.get('cookies');

    if (!(value instanceof File)) {
      throw new Error('Select a cookies.txt file exported from your own YouTube browser session.');
    }

    const bytes = Buffer.from(await value.arrayBuffer());
    const result = await createYouTubeSession(bytes);

    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create YouTube access session.' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  await releaseYouTubeSession(url.searchParams.get('id'));
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  });
}
