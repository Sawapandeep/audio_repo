// Minimal structural types for the File System Access API. We declare our
// own instead of relying on lib.dom's (partial/version-dependent) coverage,
// and because these same shapes need to be reused across page.tsx and the
// IndexedDB helper below.

export type DirectoryFileHandle = {
    kind: 'file';
    name: string;
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  };
  
  export type DirectoryHandle = {
    kind: 'directory';
    name: string;
    queryPermission?(options?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(options?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    values(): AsyncIterableIterator<DirectoryFileHandle | DirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<DirectoryFileHandle>;
  };