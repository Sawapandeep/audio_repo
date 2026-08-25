import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const script = path.join(root, 'server', 'yt_dlp_service.py');

export function runYtDlp(payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // const python = process.env.PYTHON_BIN || 'python3';
    const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
    const env = { ...process.env };
    if (process.env.YT_DLP_PYTHONPATH) env.PYTHONPATH = process.env.YT_DLP_PYTHONPATH;
    const child = spawn(python, [script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => stdout += chunk.toString());
    child.stderr.on('data', chunk => stderr += chunk.toString());
    child.on('error', err => reject(new Error(`Unable to start yt-dlp runtime: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) {
        try { const parsed = JSON.parse(stdout); if (parsed.error) return reject(new Error(parsed.error)); } catch {}
        return reject(new Error(stderr.trim() || 'yt-dlp operation failed.'));
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('yt-dlp returned invalid data.')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
