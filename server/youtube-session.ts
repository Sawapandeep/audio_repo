import crypto from 'node:crypto';

const DEFAULT_TTL_SECONDS = 15 * 60;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type YouTubeOAuthToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
};

export type YouTubeSession = {
  id: string;
  token: YouTubeOAuthToken;
  createdAt: number;
  expiresAt: number;
};

// This is intentionally process-local. AudioDrop is currently a personal,
// single-service deployment on Render. A database/Redis session store is not
// necessary unless the app later becomes multi-instance/multi-user.
const sessions = new Map<string, YouTubeSession>();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

function clientId() {
  return requiredEnv('GOOGLE_YOUTUBE_CLIENT_ID');
}

function clientSecret() {
  return requiredEnv('GOOGLE_YOUTUBE_CLIENT_SECRET');
}

function redirectUri() {
  return requiredEnv('GOOGLE_YOUTUBE_REDIRECT_URI');
}

function ttlMs() {
  const configured = Number(process.env.YOUTUBE_OAUTH_SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS * 1000;
  return Math.min(Math.max(Math.round(configured), 60), 60 * 60) * 1000;
}

export function buildYouTubeAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: YOUTUBE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error_description === 'string'
        ? data.error_description
        : typeof data?.error === 'string'
          ? data.error
          : 'Google OAuth token request failed.'
    );
  }
  return data as GoogleTokenResponse;
}

function createSessionFromToken(data: GoogleTokenResponse): YouTubeSession {
  if (!data.access_token) throw new Error('Google did not return an access token.');
  const refreshToken = data.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. If AudioDrop was already authorized, remove AudioDrop's access from your Google Account and connect again."
    );
  }

  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs();
  const token: YouTubeOAuthToken = {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000,
    scope: data.scope || YOUTUBE_SCOPE,
    tokenType: data.token_type || 'Bearer',
  };

  const session: YouTubeSession = {
    id: crypto.randomUUID(),
    token,
    createdAt,
    expiresAt,
  };

  sessions.set(session.id, session);
  scheduleExpiry(session);
  return session;
}

export async function completeYouTubeOAuthWebFlow(code: string) {
  const cleanCode = code.trim();
  if (!cleanCode) throw new Error('Google authorization code is missing.');

  const data = await tokenRequest({
    client_id: clientId(),
    client_secret: clientSecret(),
    code: cleanCode,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });

  const session = createSessionFromToken(data);
  return {
    sessionId: session.id,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

async function refresh(session: YouTubeSession) {
  const data = await tokenRequest({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: session.token.refreshToken,
    grant_type: 'refresh_token',
  });

  session.token = {
    ...session.token,
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000,
    scope: data.scope || session.token.scope,
    tokenType: data.token_type || session.token.tokenType,
  };
}

async function revoke(refreshToken: string) {
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
    cache: 'no-store',
  }).catch(() => undefined);
}

async function removeSession(session: YouTubeSession, revokeToken = true) {
  sessions.delete(session.id);
  if (revokeToken) await revoke(session.token.refreshToken);
}

function scheduleExpiry(session: YouTubeSession) {
  const timer = setTimeout(() => {
    const current = sessions.get(session.id);
    if (current) void removeSession(current, true);
  }, Math.max(0, session.expiresAt - Date.now()));
  timer.unref?.();
}

export async function getYouTubeSession(sessionId: unknown): Promise<YouTubeSession> {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('Connect YouTube with Google before using this feature.');
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('The temporary YouTube access session has expired. Connect YouTube again.');
  }

  if (Date.now() >= session.expiresAt) {
    await removeSession(session, true);
    throw new Error('The temporary YouTube access session has expired. Connect YouTube again.');
  }

  if (Date.now() + 60_000 >= session.token.expiresAt) {
    try {
      await refresh(session);
    } catch {
      await removeSession(session, true);
      throw new Error('The Google YouTube authorization expired or was revoked. Connect YouTube again.');
    }
  }

  return session;
}

export function youtubeAuthForPython(session: YouTubeSession) {
  return {
    accessToken: session.token.accessToken,
    refreshToken: session.token.refreshToken,
    expiresAt: Math.floor(session.token.expiresAt / 1000),
    scope: session.token.scope,
    tokenType: session.token.tokenType,
  };
}

export async function releaseYouTubeSession(sessionId: unknown) {
  if (typeof sessionId !== 'string' || !sessionId) return;
  const session = sessions.get(sessionId);
  if (session) await removeSession(session, true);
}

export function youtubeSessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
