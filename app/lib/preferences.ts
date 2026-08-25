// Small, dependency-free cookie helpers for persisting non-sensitive UI
// preferences and playlist sync history. Deliberately NOT used for the
// selected local folder handle — that can't survive JSON/cookie storage
// and lives in IndexedDB instead (see lib/directoryStore.ts).

export type Preferences = { format: string; quality: number };
export type SyncHistoryEntry = {
  title: string;
  url: string;
  lastSynced: string;
  trackCount: number;
};

const PREFERENCES_COOKIE = 'audiodrop_preferences';
const HISTORY_COOKIE = 'audiodrop_sync_history';
const MAX_HISTORY = 5;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function loadPreferences(): Preferences | null {
  const raw = readCookie(PREFERENCES_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.format === 'string' && typeof parsed.quality === 'number') {
      return { format: parsed.format, quality: parsed.quality };
    }
  } catch {
    // Malformed cookie — ignore and fall back to defaults.
  }
  return null;
}

export function savePreferences(preferences: Preferences) {
  writeCookie(PREFERENCES_COOKIE, JSON.stringify(preferences));
}

export function loadSyncHistory(): SyncHistoryEntry[] {
  const raw = readCookie(HISTORY_COOKIE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is SyncHistoryEntry =>
          entry && typeof entry.url === 'string' && typeof entry.title === 'string'
      );
    }
  } catch {
    // Malformed cookie — ignore.
  }
  return [];
}

export function recordSyncHistory(entry: SyncHistoryEntry) {
  const history = loadSyncHistory().filter(existing => existing.url !== entry.url);
  history.unshift(entry);
  writeCookie(HISTORY_COOKIE, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function removeSyncHistoryEntry(url: string) {
  const history = loadSyncHistory().filter(existing => existing.url !== url);
  writeCookie(HISTORY_COOKIE, JSON.stringify(history));
}