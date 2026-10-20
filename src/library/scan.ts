/**
 * Folder walking and rescan diffing. Pure logic, deliberately decoupled from the real
 * File System Access API so the unit tests can drive it with a fake directory handle
 * (a small object with `entries()`). See tests/unit/scan.test.ts.
 */

export const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i;

export function isAudioName(name: string): boolean {
  return AUDIO_EXT.test(name);
}

/** The subset of a file handle the walker needs. The real FileSystemFileHandle satisfies it. */
export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

/** The subset of a directory handle the walker needs. */
export interface DirHandleLike {
  kind: 'directory';
  name: string;
  entries(): AsyncIterable<[string, DirHandleLike | FileHandleLike]>;
}

export interface ScanEntry {
  /** Relative path from the scanned root, POSIX separators. */
  path: string;
  name: string;
  getFile: () => Promise<File>;
}

/** Yield every audio file under a directory, recursively, with its relative path. */
export async function* walk(dir: DirHandleLike, prefix = ''): AsyncGenerator<ScanEntry> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      yield* walk(handle, path);
    } else if (isAudioName(name)) {
      yield { path, name, getFile: () => handle.getFile() };
    }
  }
}

export interface ScanStat {
  path: string;
  size: number;
  lastModified: number;
}

export interface ScanDiff {
  added: ScanStat[];
  changed: ScanStat[];
  removed: string[];
}

/** Compare a previous scan to the current one by path + size + last-modified time. */
export function diffScan(prev: ScanStat[], cur: ScanStat[]): ScanDiff {
  const prevByPath = new Map(prev.map((p) => [p.path, p]));
  const curPaths = new Set(cur.map((c) => c.path));
  const added: ScanStat[] = [];
  const changed: ScanStat[] = [];
  for (const c of cur) {
    const p = prevByPath.get(c.path);
    if (!p) added.push(c);
    else if (p.size !== c.size || p.lastModified !== c.lastModified) changed.push(c);
  }
  const removed = prev.filter((p) => !curPaths.has(p.path)).map((p) => p.path);
  return { added, changed, removed };
}
