import { NextResponse } from 'next/server';
import { getJob } from '@/server/jobs';
import fs from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  const {id}=await context.params; const job=getJob(id);
  if (!job || job.status !== 'completed' || !job.filePath) return NextResponse.json({error:'Download is not ready.'},{status:404});
  const data=await fs.readFile(job.filePath);
  return new Response(data,{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="audio-${id}.zip"`,'cache-control':'no-store'}});
}
