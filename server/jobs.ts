import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type Job = { id:string; status:'queued'|'running'|'completed'|'failed'; progress:number; current?:string; completed:number; total:number; error?:string; downloadUrl?:string; filePath?:string };
const jobs = new Map<string, Job>();
const root = process.cwd();
const script = path.join(root, 'server', 'yt_dlp_service.py');
const tempRoot = path.resolve(process.env.DOWNLOAD_TEMP_DIR || path.join(root, 'server', 'jobs'));
let active = 0;

export function getJob(id:string) { return jobs.get(id); }

export async function createPlaylistJob(input:{url:string;format:string;quality:number;selected:string[]}) {
  const id = randomUUID();
  const job: Job = { id, status:'queued', progress:0, completed:0, total:input.selected.length };
  jobs.set(id, job);
  await fs.mkdir(tempRoot, {recursive:true});
  run(job, input).catch(err => { job.status='failed'; job.error=err instanceof Error ? err.message : 'Job failed.'; });
  return publicJob(job);
}

function publicJob(job:Job) { const {filePath, ...safe} = job; return safe; }

async function run(job:Job, input:{url:string;format:string;quality:number;selected:string[]}) {
  const max = Number(process.env.MAX_CONCURRENT_JOBS || 2);
  while (active >= max) await new Promise(r=>setTimeout(r,500));
  active++;
  const dir = path.join(tempRoot, job.id); await fs.mkdir(dir, {recursive:true});
  try {
    job.status='running';
    const child = spawn(
      process.env.PYTHON_BIN ||
        (process.platform === 'win32' ? 'python' : 'python3'),
      [script],
      {env:{...process.env, ...(process.env.YT_DLP_PYTHONPATH ? {PYTHONPATH:process.env.YT_DLP_PYTHONPATH}:{})}, stdio:['pipe','pipe','pipe']});
    let stderr=''; let last='';
    child.stderr.on('data', c=>stderr += c.toString());
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk:string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const msg=JSON.parse(line);
          if (msg.type==='progress') { job.completed=msg.completed ?? job.completed; job.total=msg.total ?? job.total; job.current=msg.current; job.progress=job.total ? Math.round((job.completed/job.total)*100) : 0; }
          if (msg.type==='result') { job.filePath=msg.filePath; }
        } catch { last=line; }
      }
    });
    child.stdin.end(JSON.stringify({...input, action:'download_playlist', outputDir:dir, jobId:job.id}));
    await new Promise<void>((resolve,reject)=>child.on('close', code=>code===0?resolve():reject(new Error(stderr.trim() || last || 'Playlist download failed.'))));
    if (!job.filePath) throw new Error('Playlist finished without an output file.');
    job.completed=job.total; job.progress=100; job.status='completed'; job.downloadUrl=`/api/jobs/${job.id}/download`;
    setTimeout(() => {
      const current = jobs.get(job.id);
      if (current?.filePath) fs.rm(path.dirname(current.filePath), {recursive:true, force:true}).catch(() => undefined);
      jobs.delete(job.id);
    }, 15 * 60 * 1000).unref();
  } finally { active--; }
}
