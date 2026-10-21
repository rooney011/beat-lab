import { computed, effect, signal } from '@preact/signals';
import {
  deleteTrack,
  getAllFolders,
  getAllTracks,
  getPlayState,
  putCoverOnce,
  putFolder,
  putPlayState,
  putTrack,
  putTracks,
} from './db';
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
import { measuredGainDb, measureLoudness, replayGainDb } from './loudness';
import { parseMeta } from './meta';
import {
  currentId as queueCurrentId,
  emptyQueue,
  next as queueNext,
  playNow,
  previous as queuePrevious,
  type QueueState,
  type RepeatMode,
  setRepeat,
  setShuffle,
} from './queue';
import { searchTracks } from './search';
import { type DirHandleLike, type ScanEntry, type ScanStat, walk } from './scan';
import { makeCover } from './thumb';
import type { LinkedFolder, PersistedPlayState, Track } from './types';

export type LibraryView = 'albums' | 'artists' | 'songs' | 'queue' | 'search';

export interface ScanProgress {
  done: number;
  /** 0 when the total isn't known yet (folder scans count as they walk). */
  total: number;
  label: string;
}

/** Leaving the library screen is the host app's job (the transport handles actual playback). */
export interface LibraryBridge {
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

// ---------------------------------------------------------------- playback / queue

/** The display metadata the library already resolved, so playback shows the real title, not the OPFS file name. */
export interface PlayMeta {
  title: string;
  artist: string;
  album: string;
  year?: number;
}

/** What the host app provides so the library queue can drive the deck engine. */
export interface Transport {
  /** `focus` brings the Now Playing stage forward — set only for an explicit pick, not auto-advance. */
  play(
    file: File,
    deck: { id: string; gainDb: number },
    crossfadeSec: number,
    startSec: number,
    meta?: PlayMeta,
    focus?: boolean,
  ): void;
  seek(seconds: number): void;
  position(): number;
  duration(): number;
  setGain(db: number): void;
}

export const queue = signal<QueueState>(emptyQueue());
export const nowPlayingId = signal<string | null>(null);
export const crossfadeSec = signal(4);

let transport: Transport | null = null;
let resumeId: string | null = null;
let resumePosition = 0;

function trackById(id: string): Track | undefined {
  return tracks.value.find((t) => t.id === id);
}

function metaOf(track: Track | undefined): PlayMeta | undefined {
  return track && { title: track.title, artist: track.artist, album: track.album, year: track.year };
}

/** Best-known loudness trim: a measurement first, then a ReplayGain tag, else 0 dB. */
function gainDbFor(track: Track): number {
  if (track.loudness) return measuredGainDb(track.loudness);
  if (track.replayGain?.track !== undefined) return replayGainDb(track.replayGain.track, track.replayGain.trackPeak);
  return 0;
}

function bumpPlayCount(id: string): Track | undefined {
  const track = trackById(id);
  if (!track) return undefined;
  const updated: Track = { ...track, playCount: track.playCount + 1, lastPlayedAt: Date.now() };
  void putTrack(updated);
  tracks.value = tracks.value.map((t) => (t.id === id ? updated : t));
  return updated;
}

// persistence
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Throttle, not debounce: the 500 ms crossfade watcher calls this constantly, and a debounce would
// keep resetting and never fire. Coalesce into one write every 1.5 s, reading the latest state then.
function persistSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePlayState();
  }, 1500);
}
function savePlayState(): void {
  const q = queue.value;
  const state: PersistedPlayState = {
    order: q.order,
    index: q.index,
    history: q.history,
    shuffle: q.shuffle,
    repeat: q.repeat,
    position: transport?.position() ?? resumePosition,
    crossfadeSec: crossfadeSec.value,
  };
  void putPlayState(state);
}

// crossfade watcher: near a track's end, start the next one so they overlap
let watcher: ReturnType<typeof setInterval> | null = null;
let crossfadedFrom: string | null = null;
function startWatcher(): void {
  if (watcher) return;
  watcher = setInterval(() => {
    const t = transport;
    if (!t) return;
    persistSoon();
    const id = nowPlayingId.value;
    const cross = crossfadeSec.value;
    const dur = t.duration();
    if (id && cross > 0 && dur > 0 && crossfadedFrom !== id && dur - t.position() <= cross && hasNext()) {
      crossfadedFrom = id;
      void advance(cross);
    }
  }, 500);
}
function stopWatcher(): void {
  if (watcher) clearInterval(watcher);
  watcher = null;
}

function hasNext(): boolean {
  return queueCurrentId(queueNext(queue.value)) !== null;
}

async function playCurrent(cross: number, focus = false): Promise<void> {
  const id = queueCurrentId(queue.value);
  nowPlayingId.value = id;
  if (!id || !transport) {
    stopWatcher();
    return;
  }
  const file = await fileForTrack(trackById(id) ?? ({ id } as Track));
  if (!file) {
    // Skip an unplayable track.
    queue.value = queueNext(queue.value);
    if (queueCurrentId(queue.value)) return playCurrent(cross, focus);
    nowPlayingId.value = null;
    stopWatcher();
    return;
  }
  const track = bumpPlayCount(id);
  crossfadedFrom = null;
  const startSec = id === resumeId ? resumePosition : 0;
  resumeId = null;
  resumePosition = 0;
  transport.play(file, { id, gainDb: track ? gainDbFor(track) : 0 }, cross, startSec, metaOf(track), focus);
  startWatcher();
  persistSoon();
  if (track) void measureAndApply(track);
}

async function advance(cross: number): Promise<void> {
  queue.value = queueNext(queue.value);
  if (queueCurrentId(queue.value) === null) {
    stopWatcher();
    nowPlayingId.value = null;
    persistSoon();
    return;
  }
  await playCurrent(cross);
}

/** Play a track now, seeding the queue from the list it was shown in. */
export async function playTrack(track: Track, contextIds?: string[]): Promise<void> {
  const ids = contextIds && contextIds.length ? contextIds : [track.id];
  queue.value = playNow(queue.value, ids, track.id, Math.random);
  // An explicit pick jumps to Now Playing; later auto-advances/skips leave the current screen alone.
  await playCurrent(0, true);
}

/** Play a whole list shuffled now — the album/artist "Shuffle" button; turns the shuffle toggle on. */
export async function shufflePlay(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const start = ids[Math.floor(Math.random() * ids.length)];
  queue.value = playNow({ ...queue.value, shuffle: true }, ids, start, Math.random);
  await playCurrent(0, true);
}

export function nextTrack(): void {
  // A manual skip switches now; the crossfade is only for tracks that run out on their own.
  void advance(0);
}

export function previousTrack(): void {
  if ((transport?.position() ?? 0) > 3) {
    transport?.seek(0);
    return;
  }
  queue.value = queuePrevious(queue.value);
  void playCurrent(0);
}

/** The host calls this when the current track ends on its own. Returns true if the queue advanced. */
export function onQueueEnded(): boolean {
  if (!hasNext() && queue.value.repeat === 'off') {
    nowPlayingId.value = null;
    stopWatcher();
    persistSoon();
    return false;
  }
  void advance(0); // a crossfade, if any, already happened before the end
  return true;
}

/** A direct file open took over: drop the queue. */
export function onExternalPlay(): void {
  queue.value = emptyQueue();
  nowPlayingId.value = null;
  stopWatcher();
  persistSoon();
}

export function toggleShuffle(): void {
  queue.value = setShuffle(queue.value, !queue.value.shuffle, Math.random);
  persistSoon();
}

export function cycleRepeat(): void {
  const modes: RepeatMode[] = ['off', 'all', 'one'];
  const i = modes.indexOf(queue.value.repeat);
  queue.value = setRepeat(queue.value, modes[(i + 1) % modes.length]);
  persistSoon();
}

export function setCrossfade(sec: number): void {
  crossfadeSec.value = Math.max(0, Math.min(12, Math.round(sec)));
  persistSoon();
}

export function setTransport(t: Transport): void {
  transport = t;
  void restorePlayState();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', savePlayState);
}

/** Run `cb` whenever the queue, crossfade length or now-playing track changes (for host chrome). */
export function subscribePlayback(cb: () => void): () => void {
  return effect(() => {
    void queue.value;
    void crossfadeSec.value;
    void nowPlayingId.value;
    cb();
  });
}

async function restorePlayState(): Promise<void> {
  const s = await getPlayState();
  if (!s || !s.order.length) return;
  crossfadeSec.value = s.crossfadeSec || 4;
  queue.value = { order: s.order, index: s.index, history: s.history, shuffle: s.shuffle, repeat: s.repeat };
  const id = queueCurrentId(queue.value);
  nowPlayingId.value = id;
  if (id) {
    resumeId = id;
    resumePosition = s.position;
  }
}

// Background loudness measurement for the playing track (plays at 0 dB / ReplayGain until ready).
let decodeCtx: OfflineAudioContext | null = null;
async function measureAndApply(track: Track): Promise<void> {
  if (track.loudness || track.replayGain?.track !== undefined) return;
  try {
    const file = await fileForTrack(track);
    if (!file) return;
    decodeCtx ??= new OfflineAudioContext(1, 1, 44100);
    const buf = await decodeCtx.decodeAudioData(await file.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    const result = measureLoudness(channels, buf.sampleRate);
    if (!Number.isFinite(result.lufs)) return;
    const updated: Track = { ...track, loudness: result };
    void putTrack(updated);
    tracks.value = tracks.value.map((t) => (t.id === track.id ? updated : t));
    if (nowPlayingId.value === track.id) transport?.setGain(measuredGainDb(result));
  } catch {
    /* leave the track at 0 dB */
  }
}

// Used only by the rescan path and tests that want the current on-disk fingerprint.
export function statsOf(list: Track[]): ScanStat[] {
  return list
    .filter((t) => t.source === 'folder' && t.path)
    .map((t) => ({ path: t.path as string, size: t.size, lastModified: t.lastModified }));
}
