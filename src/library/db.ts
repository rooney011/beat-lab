import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Cover, LinkedFolder, PersistedPlayState, Track, TrackAnalysis } from './types';

/**
 * The library's IndexedDB. Tracks, deduplicated covers and linked-folder handles each get a store;
 * `blobs` holds imported audio when OPFS is unavailable (see files.ts). `analysis` holds the Phase 2
 * per-track beat/section/drop/key result, keyed by track id. Grouping and sorting are done in memory
 * — a few thousand tracks filter in milliseconds — so no indexes are needed yet.
 */
interface LibraryDB extends DBSchema {
  tracks: { key: string; value: Track };
  covers: { key: string; value: Cover };
  folders: { key: string; value: LinkedFolder };
  blobs: { key: string; value: Blob };
  playstate: { key: string; value: PersistedPlayState };
  analysis: { key: string; value: TrackAnalysis };
}

let dbp: Promise<IDBPDatabase<LibraryDB>> | null = null;

function db(): Promise<IDBPDatabase<LibraryDB>> {
  if (!dbp)
    dbp = openDB<LibraryDB>('beat-lab-library', 3, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('tracks', { keyPath: 'id' });
          d.createObjectStore('covers', { keyPath: 'id' });
          d.createObjectStore('folders', { keyPath: 'id' });
          d.createObjectStore('blobs');
        }
        if (oldVersion < 2) d.createObjectStore('playstate');
        if (oldVersion < 3) d.createObjectStore('analysis', { keyPath: 'trackId' });
      },
    });
  return dbp;
}

const PLAYSTATE_KEY = 'current';

export async function getPlayState(): Promise<PersistedPlayState | undefined> {
  return (await db()).get('playstate', PLAYSTATE_KEY);
}

export async function putPlayState(s: PersistedPlayState): Promise<void> {
  await (await db()).put('playstate', s, PLAYSTATE_KEY);
}

export async function getAllTracks(): Promise<Track[]> {
  return (await db()).getAll('tracks');
}

export async function putTracks(tracks: Track[]): Promise<void> {
  if (!tracks.length) return;
  const d = await db();
  const tx = d.transaction('tracks', 'readwrite');
  await Promise.all([...tracks.map((t) => tx.store.put(t)), tx.done]);
}

export async function putTrack(t: Track): Promise<void> {
  await (await db()).put('tracks', t);
}

export async function deleteTrack(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['tracks', 'blobs', 'analysis'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').delete(id),
    tx.objectStore('blobs').delete(id),
    tx.objectStore('analysis').delete(id),
    tx.done,
  ]);
}

export async function getCover(id: string): Promise<Cover | undefined> {
  return (await db()).get('covers', id);
}

/** Store a cover once; many tracks from one album share it by image hash. */
export async function putCoverOnce(c: Cover): Promise<void> {
  const d = await db();
  if (await d.getKey('covers', c.id)) return;
  await d.put('covers', c);
}

export async function getAllFolders(): Promise<LinkedFolder[]> {
  return (await db()).getAll('folders');
}

export async function getFolder(id: string): Promise<LinkedFolder | undefined> {
  return (await db()).get('folders', id);
}

export async function putFolder(f: LinkedFolder): Promise<void> {
  await (await db()).put('folders', f);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db()).get('blobs', key);
}

// ---------------------------------------------------------------- analysis (Phase 2)

export async function getAnalysis(trackId: string): Promise<TrackAnalysis | undefined> {
  return (await db()).get('analysis', trackId);
}

export async function putAnalysis(a: TrackAnalysis): Promise<void> {
  await (await db()).put('analysis', a);
}

export async function deleteAnalysis(trackId: string): Promise<void> {
  await (await db()).delete('analysis', trackId);
}

/** The track ids that already have a stored analysis record (keys only — cheap, no payloads). */
export async function getAnalyzedIds(): Promise<Set<string>> {
  return new Set(await (await db()).getAllKeys('analysis'));
}
