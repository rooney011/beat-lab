import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guessFromFilename, parseTags, readFileTags } from '../../src/meta/tags';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/tags/${name}`, import.meta.url))));

describe('parseTags', () => {
  it('reads ID3v2 text frames and the cover picture from an MP3', () => {
    const t = parseTags(fixture('The Test Pressings - Midnight Signal.mp3'));
    expect(t).toMatchObject({
      title: 'Midnight Signal',
      artist: 'The Test Pressings',
      album: 'Proof Sheets',
      year: '2024',
    });
    expect(t.pic?.mime).toBe('image/jpeg');
    // JPEG data starts with the SOI marker.
    expect([t.pic?.data[0], t.pic?.data[1]]).toEqual([0xff, 0xd8]);
  });

  it('reads FLAC Vorbis comments and the PICTURE block', () => {
    const t = parseTags(fixture('paper-moon-static.flac-head'));
    expect(t).toMatchObject({
      title: 'Paper Moon Static',
      artist: 'Halftone Choir',
      album: 'Misregistered',
      year: '2023',
    });
    expect(t.pic?.mime).toBe('image/png');
    expect(Array.from(t.pic?.data.subarray(1, 4) ?? [])).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  });

  it('falls back to an ID3v1 tag at the end of the file', () => {
    const u = new Uint8Array(400);
    const tail = u.subarray(400 - 128);
    const put = (off: number, s: string): void => [...s].forEach((ch, i) => (tail[off + i] = ch.charCodeAt(0)));
    put(0, 'TAG');
    put(3, 'Old Song');
    put(33, 'Old Band');
    put(93, '1999');
    expect(parseTags(u)).toMatchObject({ title: 'Old Song', artist: 'Old Band', year: '1999' });
  });

  it('never throws on junk', () => {
    expect(parseTags(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f, 1, 2, 3]))).toEqual({});
    expect(parseTags(new Uint8Array(0))).toEqual({});
  });

  it('reads tags from a File', async () => {
    const f = new File([fixture('The Test Pressings - Midnight Signal.mp3') as BlobPart], 'x.mp3', {
      type: 'audio/mpeg',
    });
    expect((await readFileTags(f)).title).toBe('Midnight Signal');
  });
});

describe('guessFromFilename', () => {
  it.each([
    ['Daft Punk - One More Time.mp3', 'Daft Punk', 'One More Time'],
    ['03 - Artist – Title (Official Audio).m4a', 'Artist', 'Title'],
    ['artist_name - song_title [Lyric Video].wav', 'artist name', 'song title'],
    ['just a title.flac', '', 'just a title'],
  ])('%s', (name, artist, title) => {
    expect(guessFromFilename(name)).toMatchObject({ artist, title });
  });
});
