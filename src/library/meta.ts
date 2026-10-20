/**
 * Tag and cover reading via `music-metadata`, loaded lazily so its ~100 KB (and the per-format
 * loaders it dynamic-imports) only land when a scan actually runs. It is imported on the main
 * thread rather than in a worker: the project's one Web Worker (the Essentia mood model) is a
 * classic/IIFE worker, and `music-metadata`'s dynamic-import code-splitting can't be bundled into
 * an IIFE worker without changing the global `worker.format` that worker depends on. Header-only
 * parsing is fast, and the scan loop yields between files to keep the main thread responsive.
 */

export interface ParsedMeta {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration: number;
  picture?: { data: Uint8Array; format: string } | null;
  replayGain?: { track?: number; album?: number; trackPeak?: number; albumPeak?: number };
}

let modPromise: Promise<typeof import('music-metadata')> | null = null;

function mm(): Promise<typeof import('music-metadata')> {
  return (modPromise ??= import('music-metadata'));
}

function gainToDb(g: { dB?: number } | number | undefined): number | undefined {
  if (typeof g === 'number') return g;
  return g?.dB;
}

/** Read common tags, duration and the first embedded picture. Never throws. */
export async function parseMeta(file: Blob): Promise<ParsedMeta> {
  try {
    const { parseBlob } = await mm();
    const md = await parseBlob(file, { duration: true, skipCovers: false });
    const c = md.common;
    const pic = c.picture?.[0];
    const rg = {
      track: gainToDb(c.replaygain_track_gain),
      album: gainToDb(c.replaygain_album_gain),
      trackPeak: typeof c.replaygain_track_peak?.ratio === 'number' ? c.replaygain_track_peak.ratio : undefined,
      albumPeak: typeof c.replaygain_album_peak?.ratio === 'number' ? c.replaygain_album_peak.ratio : undefined,
    };
    const hasRg = rg.track !== undefined || rg.album !== undefined;
    return {
      title: c.title,
      artist: c.artist,
      album: c.album,
      albumArtist: c.albumartist,
      year: typeof c.year === 'number' ? c.year : undefined,
      trackNo: c.track?.no ?? undefined,
      discNo: c.disk?.no ?? undefined,
      duration: md.format.duration ?? 0,
      picture: pic ? { data: pic.data, format: pic.format } : null,
      replayGain: hasRg ? rg : undefined,
    };
  } catch {
    return { duration: 0, picture: null };
  }
}
