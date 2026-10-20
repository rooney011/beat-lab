/** The persisted library model (IndexedDB). See docs/ROADMAP.md milestone 1.1 and its appendix. */

export type TrackId = string;
export type TrackSource = 'folder' | 'import';

export interface Track {
  id: TrackId;
  source: TrackSource;
  /** Linked folder this came from (folder sources). */
  folderId?: string;
  /** Relative path inside the linked folder, POSIX separators (folder sources). */
  path?: string;
  /** File name inside OPFS (import sources, when OPFS is available). */
  opfsName?: string;
  /** The imported file lives in the IndexedDB blob store keyed by `id` (OPFS fallback). */
  inDb?: boolean;
  /** SHA-256 of the file size plus its first 256 KB. Finds duplicates across sources. */
  fileHash: string;
  size: number;
  lastModified: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  /** Seconds; 0 when unknown. */
  duration: number;
  /** → covers store; absent means the generated comic cover is used. */
  coverId?: string;
  replayGain?: { track?: number; album?: number; trackPeak?: number; albumPeak?: number };
  /** Measured BS.1770 integrated loudness + sample peak, filled in by the background meter. */
  loudness?: { lufs: number; peak: number };
  addedAt: number;
  lastPlayedAt?: number;
  playCount: number;
}

export interface Cover {
  /** Hash of the image bytes, so many tracks from one album share one stored cover. */
  id: string;
  /** 256 px JPEG. */
  thumb: Blob;
  /** The original embedded picture. */
  full: Blob;
}

export interface LinkedFolder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  lastScanAt?: number;
}

/** The queue + position saved so the app resumes where you left off (paused) after a reload. */
export interface PersistedPlayState {
  order: TrackId[];
  index: number;
  /** Seconds into the current track. */
  position: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  history: TrackId[];
  /** Crossfade length setting, in seconds. */
  crossfadeSec: number;
}
