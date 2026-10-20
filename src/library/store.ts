import { computed, signal } from '@preact/signals';
import { deleteTrack, getAllFolders, getAllTracks, putCoverOnce, putFolder, putTrack, putTracks } from './db';
import {
  deleteImport,
  ensurePermission,
  fileForTrack,
  fileHashOf,
  requestPersistence,
  sha256Hex,
  storageEstimate,
  storeImport,
} from './files';
import { parseMeta } from './meta';
import { searchTracks } from './search';
import { type DirHandleLike, type ScanEntry, type ScanStat, walk } from './scan';
import { makeCover } from './thumb';
import type { LinkedFolder, Track } from './types';

export type LibraryView = 'albums' | 'artists' | 'songs' | 'search';

export interface ScanProgress {
  done: number;
  /** 0 when the total isn't known yet (folder scans count as they walk). */
  total: number;
  label: string;
}

/** What the library needs from the host app to actually play a track and leave the screen. */
export interface LibraryBridge {
  play(file: File, track: Track): void;
  close(): void;
}

// ---------------------------------------------------------------- state

export const tracks = signal<Track[]>([]);
export const folders = signal<LinkedFolder[]>([]);
export const view = signal<LibraryView>('albums');
export const query = signal('');
export const albumKey = signal<string | null>(null);
export const scan = signal<ScanProgress | null>(null);
export const storage = signal<{ usage: number; quota: number } | null>(null);
export const loaded = signal(false);

export const folderPickerSupported =
  typeof window !== 'undefined' &&
  typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export const results = computed(() => searchTracks(tracks.value, query.value));

let bridge: LibraryBridge | null = null;
export function setBridge(b: LibraryBridge): void {
  bridge = b;
}
export function closeLibrary(): void {
  bridge?.close();
}

let cancelled = false;
export function cancelScan(): void {
  cancelled = true;
}

// ---------------------------------------------------------------- grouping helpers

const SEP = '\u001f';
export function trackAlbumKey(t: Track): string {
  return `${t.albumArtist || t.artist || 'Unknown Artist'}${SEP}${t.album || 'Unknown Album'}`;
}
export function splitAlbumKey(key: string): { artist: string; album: string } {
  const [artist, album] = key.split(SEP);
  return { artist, album };
}

// ---------------------------------------------------------------- load

export async function initLibrary(): Promise<void> {
  if (loaded.value) return;
  const [all, fs, est] = await Promise.all([getAllTracks(), getAllFolders(), storageEstimate()]);
  tracks.value = all;
  folders.value = fs;
  storage.value = est;
  loaded.value = true;
}

async function refreshStorage(): Promise<void> {
  storage.value = await storageEstimate();
}

// ---------------------------------------------------------------- ingest (import + folder scan)

const BATCH = 20;

function existingHashes(): Set<string> {
  return new Set(tracks.value.map((t) => t.fileHash));
}

/** Build and persist one track from a File, sharing its cover by image hash. Returns null on skip. */
async function ingestFile(file: File, base: Partial<Track>, hashes: Set<string>): Promise<Track | null> {
  const fileHash = await fileHashOf(file);
  if (hashes.has(fileHash)) return null;
  hashes.add(fileHash);

  const meta = await parseMeta(file);

  let coverId: string | undefined;
  if (meta.picture && meta.picture.data.length > 0) {
    coverId = await sha256Hex(meta.picture.data as BufferSource);
    const blobs = await makeCover(meta.picture.data, meta.picture.format);
    if (blobs) await putCoverOnce({ id: coverId, thumb: blobs.thumb, full: blobs.full });
    else coverId = undefined;
  }

  const title = meta.title || file.name.replace(/\.[a-z0-9]+$/i, '');
  const artist = meta.artist || 'Unknown Artist';
  const track: Track = {
    id: base.id ?? crypto.randomUUID(),
    source: base.source ?? 'import',
    folderId: base.folderId,
    path: base.path,
    opfsName: base.opfsName,
    inDb: base.inDb,
    fileHash,
    size: file.size,
    lastModified: file.lastModified,
    title,
    artist,
    album: meta.album || 'Unknown Album',
    albumArtist: meta.albumArtist || artist,
    trackNo: meta.trackNo,
    discNo: meta.discNo,
    year: meta.year,
    duration: meta.duration,
    coverId,
    replayGain: meta.replayGain,
    addedAt: Date.now(),
    playCount: 0,
  };
  return track;
}

async function runIngest(
  entries:
    { file(): Promise<File>; base: Partial<Track> }[] | AsyncIterable<{ file(): Promise<File>; base: Partial<Track> }>,
  total: number,
  label: string,
): Promise<void> {
  cancelled = false;
  const hashes = existingHashes();
  let done = 0;
  let firstEver = tracks.value.length === 0;
  const pending: Track[] = [];
  scan.value = { done, total, label };

  const flush = async (): Promise<void> => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    await putTracks(batch);
    tracks.value = [...tracks.value, ...batch];
  };

  for await (const entry of entries) {
    if (cancelled) break;
    let track: Track | null;
    try {
      const file = await entry.file();
      // Imports keep their own copy; do it before building the track so opfsName is recorded.
      if ((entry.base.source ?? 'import') === 'import') {
        const id = entry.base.id ?? crypto.randomUUID();
        const where = await storeImport(id, file);
        track = await ingestFile(file, { ...entry.base, id, ...where }, hashes);
        if (!track) await deleteImport({ ...(entry.base as Track), id, ...where } as Track);
      } else {
        track = await ingestFile(file, entry.base, hashes);
      }
    } catch {
      track = null;
    }
    if (track) {
      pending.push(track);
      if (pending.length >= BATCH) await flush();
    }
    done++;
    scan.value = { done, total: Math.max(total, done), label };
    if (firstEver && tracks.value.length + pending.length > 0) {
      firstEver = false;
      void requestPersistence().then(refreshStorage);
    }
  }
  await flush();
  scan.value = null;
  void refreshStorage();
}

// ---------------------------------------------------------------- public actions

export async function importFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList).filter((f) => /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i.test(f.name));
  if (!files.length) return;
  await runIngest(
    files.map((f) => ({ file: () => Promise.resolve(f), base: { source: 'import' as const } })),
    files.length,
    'Importing',
  );
}

export async function linkFolder(): Promise<void> {
  const pick = (
    window as { showDirectoryPicker?: (o?: { id?: string; mode?: string }) => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker;
  if (!pick) return;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await pick({ id: 'music', mode: 'read' });
  } catch {
    return; // user cancelled
  }
  const folder: LinkedFolder = { id: crypto.randomUUID(), name: handle.name, handle, lastScanAt: Date.now() };
  await putFolder(folder);
  folders.value = [...folders.value, folder];
  await scanFolder(folder);
}

async function scanFolder(folder: LinkedFolder): Promise<void> {
  if (!(await ensurePermission(folder.handle))) return;
  async function* entries(): AsyncGenerator<{ file(): Promise<File>; base: Partial<Track> }> {
    for await (const e of walk(folder.handle as unknown as DirHandleLike)) {
      yield {
        file: (e as ScanEntry).getFile,
        base: {
          source: 'folder',
          folderId: folder.id,
          path: (e as ScanEntry).path,
          id: `${folder.id}:${(e as ScanEntry).path}`,
        },
      };
    }
  }
  await runIngest(entries(), 0, `Scanning ${folder.name}`);
  await putFolder({ ...folder, lastScanAt: Date.now() });
}

/** A linked folder reconnected after a reload (needs a user gesture for the permission prompt). */
export async function reconnectFolder(folderId: string): Promise<void> {
  const folder = folders.value.find((f) => f.id === folderId);
  if (folder) await scanFolder(folder);
}

export async function removeTrack(track: Track): Promise<void> {
  await deleteTrack(track.id);
  if (track.source === 'import') await deleteImport(track);
  tracks.value = tracks.value.filter((t) => t.id !== track.id);
  if (track.source === 'import') void refreshStorage();
}

export async function playTrack(track: Track): Promise<void> {
  const file = await fileForTrack(track);
  if (!file) return;
  const updated: Track = { ...track, playCount: track.playCount + 1, lastPlayedAt: Date.now() };
  void putTrack(updated);
  tracks.value = tracks.value.map((t) => (t.id === track.id ? updated : t));
  bridge?.play(file, updated);
}

// Used only by the rescan path and tests that want the current on-disk fingerprint.
export function statsOf(list: Track[]): ScanStat[] {
  return list
    .filter((t) => t.source === 'folder' && t.path)
    .map((t) => ({ path: t.path as string, size: t.size, lastModified: t.lastModified }));
}
