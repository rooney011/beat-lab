import type { Track } from './types';

// Unicode combining diacritical marks (U+0300–U+036F), left after NFD decomposition.
const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

/** Lowercase and strip diacritics so "Beyoncé" and "beyonce" match. */
export function normalize(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The normalised text a track is searched against. */
export function haystack(t: Track): string {
  return normalize(`${t.title} ${t.artist} ${t.album} ${t.albumArtist}`);
}

/** Every whitespace-separated term in the query must appear somewhere in the track. */
export function searchTracks(tracks: Track[], query: string): Track[] {
  const n = normalize(query);
  if (!n) return tracks;
  const terms = n.split(' ');
  return tracks.filter((t) => {
    const hay = haystack(t);
    return terms.every((term) => hay.includes(term));
  });
}
