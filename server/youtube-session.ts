import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type YouTubeSession = {
  id: string;
  cookiesPath: string;
  createdAt: number;
  expiresAt: number;
};

const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_COOKIE_BYTES = 2 * 1024 * 1024;
const sessions = new Map<string, YouTubeSession>();

function ttlMs() {
  const configured = Number(process.env.YOUTUBE_SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS / 1000);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS * 1000;
  return Math.min(Math.max(Math.round(configured), 60), 15 * 60) * 1000;
}

function assertCookieFile(content: Buffer) {
  if (content.length === 0) throw new Error('The cookies file is empty.');
  if (content.length > MAX_COOKIE_BYTES) throw new Error('The cookies file is too large.');
  const text = content.toString('utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine !== '# HTTP Cookie File' && firstLine !== '# Netscape HTTP Cookie File') {
    throw new Error('Unsupported cookies file. Export a Mozilla/Netscape cookies.txt file.');
  }
  if (!/\byoutube\.com\b/i.test(text) && !/\bytimg\.com\b/i.test(text)) {
    throw new Error('The cookies file does not appear to contain YouTube cookies.');
  }
}

async function removeSession(session: YouTubeSession) {
  sessions.delete(session.id);
  await fs.rm(path.dirname(session.cookiesPath), { recursive: true, force: true }).catch(() => undefined);
}

function scheduleExpiry(session: YouTubeSession) {
  const timer = setTimeout(() => {
    const current = sessions.get(session.id);
    if (current) void removeSession(current);
  }, Math.max(0, session.expiresAt - Date.now()));
  timer.unref?.();
}

export async function createYouTubeSession(cookieBytes: Buffer) {
  assertCookieFile(cookieBytes);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs();
  const root = process.env.DOWNLOAD_TEMP_DIR || os.tmpdir();
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'audiodrop-youtube-session-'));
  const cookiesPath = path.join(dir, 'cookies.txt');

  await fs.writeFile(cookiesPath, cookieBytes, { mode: 0o600 });

  const session: YouTubeSession = { id, cookiesPath, createdAt, expiresAt };
  sessions.set(id, session);
  scheduleExpiry(session);

  return {
    sessionId: id,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function getYouTubeSession(sessionId: unknown): Promise<YouTubeSession> {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('YouTube access is required for this task.');
  }

  const session = sessions.get(sessionId);
  if (!session) throw new Error('The temporary YouTube access session has expired. Connect YouTube again.');

  if (Date.now() >= session.expiresAt) {
    await removeSession(session);
    throw new Error('The temporary YouTube access session has expired. Connect YouTube again.');
  }

  return session;
}

export async function releaseYouTubeSession(sessionId: unknown) {
  if (typeof sessionId !== 'string' || !sessionId) return;
  const session = sessions.get(sessionId);
  if (session) await removeSession(session);
}
