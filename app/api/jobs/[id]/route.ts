import { NextResponse } from 'next/server';
import { getJob } from '@/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  const {id}=await context.params; const job=getJob(id);
  if (!job) return NextResponse.json({error:'Job not found.'},{status:404});
  const {filePath,...safe}=job; return NextResponse.json(safe,{headers:{'cache-control':'no-store'}});
}
