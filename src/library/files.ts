import { getBlob, getFolder, putBlob } from './db';
import type { Track } from './types';

/** SHA-256 hex of a buffer. */
export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A content fingerprint: size plus the first 256 KB. Cheap, and stable across copies of a file. */
export async function fileHashOf(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const prefix = new TextEncoder().encode(`${file.size}:`);
  const buf = new Uint8Array(prefix.length + head.length);
  buf.set(prefix);
  buf.set(head, prefix.length);
  return sha256Hex(buf);
}

// ---------------------------------------------------------------- OPFS (imported files)

function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function tracksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('tracks', { create: true });
}

/** Keep a copy of an imported file: OPFS when available, otherwise the IndexedDB blob store. */
export async function storeImport(id: string, file: File): Promise<Pick<Track, 'opfsName' | 'inDb'>> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = `${id}.${ext || 'bin'}`;
  if (opfsSupported()) {
    try {
      const dir = await tracksDir();
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(file);
      await w.close();
      return { opfsName: name };
    } catch {
      // fall through to the IndexedDB fallback
    }
  }
  await putBlob(id, file);
  return { inDb: true };
}

export async function deleteImport(track: Track): Promise<void> {
  if (track.opfsName && opfsSupported()) {
    try {
      const dir = await tracksDir();
      await dir.removeEntry(track.opfsName);
    } catch {
      /* already gone */
    }
  }
}

async function readImport(track: Track): Promise<File | null> {
  if (track.opfsName && opfsSupported()) {
    try {
      const dir = await tracksDir();
      const fh = await dir.getFileHandle(track.opfsName);
      return await fh.getFile();
    } catch {
      /* fall through */
    }
  }
  if (track.inDb) {
    const b = await getBlob(track.id);
    if (b) return new File([b], track.title || 'track');
  }
  return null;
}

// ---------------------------------------------------------------- linked folders

type PermMode = 'read' | 'readwrite';
interface Permissioned {
  queryPermission?(d?: { mode?: PermMode }): Promise<PermissionState>;
  requestPermission?(d?: { mode?: PermMode }): Promise<PermissionState>;
}

/** Re-prompt for a linked folder if needed. Must be called from a user gesture to request. */
export async function ensurePermission(handle: FileSystemDirectoryHandle, mode: PermMode = 'read'): Promise<boolean> {
  const h = handle as unknown as Permissioned;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode })) === 'granted') return true;
  if (!h.requestPermission) return false;
  return (await h.requestPermission({ mode })) === 'granted';
}

async function fileAtPath(dir: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  const parts = path.split('/');
  try {
    let cur = dir;
    for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i]);
    const fh = await cur.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/** Resolve a playable File for a track, from OPFS, the IndexedDB fallback, or its linked folder. */
export async function fileForTrack(track: Track): Promise<File | null> {
  if (track.source === 'import') return readImport(track);
  if (track.source === 'folder' && track.folderId && track.path) {
    const folder = await getFolder(track.folderId);
    if (!folder) return null;
    if (!(await ensurePermission(folder.handle))) return null;
    return fileAtPath(folder.handle, track.path);
  }
  return null;
}

// ---------------------------------------------------------------- storage safety

export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
