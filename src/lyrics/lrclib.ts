/**
 * Synced-lyrics lookup on LRCLIB (https://lrclib.net), a free, open lyrics database.
 * Only the artist, title and duration are sent; the audio never leaves the device.
 */
export interface LrclibHit {
  syncedLyrics: string;
  artistName?: string;
  trackName?: string;
}

interface LrclibRecord {
  syncedLyrics?: string | null;
  artistName?: string;
  trackName?: string;
  duration?: number;
}

const API = 'https://lrclib.net/api';

export async function findSyncedLyrics(
  query: { artist: string; title: string; q: string; duration: number },
  signal?: AbortSignal,
): Promise<LrclibHit | null> {
  const urls: string[] = [];
  if (query.artist && query.title) {
    urls.push(
      `${API}/get?` +
        new URLSearchParams({
          artist_name: query.artist,
          track_name: query.title,
          duration: String(Math.round(query.duration || 0)),
        }),
    );
  }
  if (query.q) urls.push(`${API}/search?` + new URLSearchParams({ q: query.q }));
  for (const url of urls) {
    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    const body = (await res.json()) as LrclibRecord | LrclibRecord[];
    const rec = Array.isArray(body)
      ? body.find(
          (x) => x?.syncedLyrics && (!query.duration || !x.duration || Math.abs(x.duration - query.duration) < 6),
        )
      : body;
    if (rec?.syncedLyrics)
      return { syncedLyrics: rec.syncedLyrics, artistName: rec.artistName, trackName: rec.trackName };
  }
  return null;
}
