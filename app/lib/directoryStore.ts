import type { DirectoryHandle } from './fsTypes';

// FileSystemDirectoryHandle objects are structured-cloneable, so Chromium
// browsers can store the *handle itself* (not its contents) in IndexedDB.
// This is the only browser storage that can hold a permission-bound handle;
// cookies/localStorage can only hold strings and would silently lose it.
// Re-use across sessions still depends on the browser re-confirming
// permission (see verifyStoredDirectoryHandle in page.tsx).

const DB_NAME = 'audiodrop';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const DIRECTORY_KEY = 'syncDirectory';

function isSupported() {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDirectoryHandle(handle: DirectoryHandle): Promise<void> {
  if (!isSupported()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, DIRECTORY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Storage can fail (private browsing, quota, unsupported browser) —
    // sync still works, the user just has to re-pick the folder next time.
  }
}

export async function loadDirectoryHandle(): Promise<DirectoryHandle | null> {
  if (!isSupported()) return null;
  try {
    const db = await openDb();
    const handle = await new Promise<DirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(DIRECTORY_KEY);
      request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  if (!isSupported()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(DIRECTORY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Nothing to do if this fails — worst case the stale handle lingers.
  }
}