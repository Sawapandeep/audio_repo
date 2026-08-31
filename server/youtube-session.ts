import crypto from 'node:crypto';

const DEFAULT_TTL_SECONDS = 15 * 60;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

type GoogleTokenResponse = {
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

const sessions = new Map<string, YouTubeSession>();

function clientId() {
  const value = process.env.GOOGLE_YOUTUBE_CLIENT_ID?.trim();
  if (!value) throw new Error('GOOGLE_YOUTUBE_CLIENT_ID is not configured on the server.');
  return value;
}

function clientSecret() {
  const value = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET?.trim();
  if (!value) throw new Error('GOOGLE_YOUTUBE_CLIENT_SECRET is not configured on the server.');
  return value;
}

function ttlMs() {
  const configured = Number(process.env.YOUTUBE_OAUTH_SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS * 1000;
  return Math.min(Math.max(Math.round(configured), 60), 60 * 60) * 1000;
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

export async function startYouTubeOAuth() {
  const response = await fetch('https://oauth2.googleapis.com/device/code', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      scope: YOUTUBE_SCOPE,
    }),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error_description === 'string'
        ? data.error_description
        : typeof data?.error === 'string'
          ? data.error
          : 'Unable to start Google YouTube authorization.'
    );
  }

  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verificationUrl: String(data.verification_url),
    expiresIn: Number(data.expires_in || 1800),
    interval: Math.max(5, Number(data.interval || 5)),
  };
}

export async function completeYouTubeOAuth(deviceCode: string) {
  const data = await tokenRequest({
    client_id: clientId(),
    client_secret: clientSecret(),
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  const refreshToken = data.refresh_token;
  if (!refreshToken) throw new Error('Google did not return a refresh token. Please authorize AudioDrop again.');

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
  if (!session) throw new Error('The temporary YouTube access session has expired. Connect YouTube again.');

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
