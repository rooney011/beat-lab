/** The persisted library model (IndexedDB). See docs/ROADMAP.md milestone 1.1 and its appendix. */

import type { MoodId } from '../types';

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

/**
 * Per-track analysis computed once in the background (docs/ROADMAP.md §Phase 2 and its appendix).
 * Bump `ANALYSIS_VERSION` when an algorithm changes; the queue redoes stale records.
 *
 * Milestone 2.1 only measures loudness (stored on `Track.loudness`); the extraction fields below
 * are filled in 2.2. Until then `beatConfidence` stays 0, and every consumer requires it to be at
 * least 0.5 before trusting the grid/script — so an unanalysed track falls back to reactive visuals.
 */
export const ANALYSIS_VERSION = 1;

export type SectionKind = 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'outro' | 'other';

export interface AnalysisSection {
  /** Seconds. */
  start: number;
  end: number;
  kind: SectionKind;
  /** Mean energy, 0..1. */
  energy: number;
  /** 0..1. */
  confidence: number;
}

export interface AnalysisDrop {
  /** Seconds. */
  time: number;
  /** 0..1. */
  confidence: number;
}

export interface AnalysisMood {
  id: MoodId;
  arousal: number;
  valence: number;
  confidence: number;
}

export interface AnalysisKey {
  /** Tonic note, e.g. "C#". */
  tonic: string;
  scale: 'major' | 'minor';
  /** Camelot wheel code, e.g. "8A". */
  camelot: string;
}

export interface TrackAnalysis {
  trackId: TrackId;
  /** The analysed file's fingerprint; lets a re-imported file reuse its result (Phase 5). */
  fileHash: string;
  version: number;
  /** Beat grid in seconds. Empty until 2.2. */
  beats: Float32Array;
  /** Detected tempo; 0 when not yet computed. */
  bpm: number;
  /** 0..1; consumers require >= 0.5 before trusting the grid or script. */
  beatConfidence: number;
  /** Index into `beats` of the first downbeat. */
  firstDownbeat: number;
  /** 0..255 per beat. */
  energy: Uint8Array;
  sections: AnalysisSection[];
  drops: AnalysisDrop[];
  mood?: AnalysisMood;
  key?: AnalysisKey;
  analysedAt: number;
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
