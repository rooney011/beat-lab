import { describe, expect, it } from 'vitest';
import { normalize, searchTracks } from '../../src/library/search';
import type { Track } from '../../src/library/types';

function track(p: Partial<Track>): Track {
  return {
    id: Math.random().toString(36),
    source: 'import',
    fileHash: 'h',
    size: 0,
    lastModified: 0,
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    duration: 0,
    addedAt: 0,
    playCount: 0,
    ...p,
  };
}

describe('normalize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Beyoncé')).toBe('beyonce');
    expect(normalize('Sigur Rós')).toBe('sigur ros');
    expect(normalize('  Múm   Go  ')).toBe('mum go');
  });
});

describe('searchTracks', () => {
  const lib = [
    track({ title: 'Halo', artist: 'Beyoncé', album: 'I Am... Sasha Fierce' }),
    track({ title: 'Single Ladies', artist: 'Beyoncé', album: 'I Am... Sasha Fierce' }),
    track({ title: 'Clair de Lune', artist: 'Debussy', album: 'Suite Bergamasque' }),
  ];

  it('matches accent-folded queries', () => {
    expect(searchTracks(lib, 'beyonce')).toHaveLength(2);
  });

  it('requires every term to appear (across title/artist/album)', () => {
    const hits = searchTracks(lib, 'beyonce halo');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Halo');
  });

  it('returns the whole list for an empty query', () => {
    expect(searchTracks(lib, '   ')).toHaveLength(3);
  });

  it('finds nothing when a term is absent', () => {
    expect(searchTracks(lib, 'beyonce debussy')).toHaveLength(0);
  });
});
