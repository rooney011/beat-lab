/**
 * Minimal tag readers for the now-playing card: ID3v2.2–2.4 and ID3v1 (MP3), MP4/M4A `ilst` atoms,
 * and FLAC Vorbis comments + PICTURE blocks. No dependencies; never throws.
 */
export interface Picture {
  mime: string;
  data: Uint8Array;
}

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  pic?: Picture;
}

type TagKey = 'title' | 'artist' | 'album' | 'year';

const clean = (s: string): string =>
  String(s ?? '')
    .replaceAll('\u0000', ' ')
    .replace(/\s+/g, ' ')
    .trim();

function decode(bytes: Uint8Array, enc: number): string {
  try {
    const label = enc === 0 ? 'latin1' : enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : 'utf-8';
    return new TextDecoder(label).decode(bytes);
  } catch {
    return '';
  }
}

export function parseTags(u: Uint8Array): Tags {
  try {
    return readTags(u);
  } catch {
    return {};
  }
}

function readTags(u: Uint8Array): Tags {
  const out: Tags = {};
  const set = (key: TagKey | undefined, value: string): void => {
    if (key && !out[key]) out[key] = clean(value);
  };
  const be = (o: number): number => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
  const str = (a: number, b: number): string => {
    let s = '';
    for (let i = a; i < b; i++) s += String.fromCharCode(u[i]);
    return s;
  };

  if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) {
    // ID3v2
    const ver = u[3];
    const flags = u[5];
    const end = Math.min(u.length, 10 + ((u[6] << 21) | (u[7] << 14) | (u[8] << 7) | u[9]));
    let p = 10;
    if (flags & 0x40) p += ver === 4 ? (u[p] << 21) | (u[p + 1] << 14) | (u[p + 2] << 7) | u[p + 3] : be(p) + 4;
    const idLen = ver === 2 ? 3 : 4;
    const hdr = ver === 2 ? 6 : 10;
    const keys: Record<string, TagKey> = {
      TIT2: 'title',
      TT2: 'title',
      TPE1: 'artist',
      TP1: 'artist',
      TALB: 'album',
      TAL: 'album',
      TYER: 'year',
      TDRC: 'year',
      TYE: 'year',
    };
    while (p + hdr < end) {
      const id = str(p, p + idLen);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const sz =
        ver === 2
          ? (u[p + 3] << 16) | (u[p + 4] << 8) | u[p + 5]
          : ver === 4
            ? (u[p + 4] << 21) | (u[p + 5] << 14) | (u[p + 6] << 7) | u[p + 7]
            : be(p + 4);
      if (sz <= 0 || p + hdr + sz > end) break;
      const d = u.subarray(p + hdr, p + hdr + sz);
      p += hdr + sz;
      if (keys[id]) set(keys[id], decode(d.subarray(1), d[0]));
      else if ((id === 'APIC' || id === 'PIC') && !out.pic) {
        const enc = d[0];
        let q = 1;
        let mime: string;
        if (id === 'PIC') {
          mime = String.fromCharCode(d[1], d[2], d[3]).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
          q = 4;
        } else {
          let z = q;
          while (z < d.length && d[z] !== 0) z++;
          mime = String.fromCharCode(...d.subarray(q, z)) || 'image/jpeg';
          q = z + 1;
        }
        q += 1; // picture type
        if (enc === 1 || enc === 2) {
          while (q + 1 < d.length && !(d[q] === 0 && d[q + 1] === 0)) q += 2;
          q += 2;
        } else {
          while (q < d.length && d[q] !== 0) q++;
          q++;
        }
        if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg');
        out.pic = { mime, data: d.subarray(q) };
      }
    }
  } else if (u.length > 12 && str(4, 8) === 'ftyp') {
    // MP4 / M4A
    const find = (start: number, stop: number, path: string[]): [number, number] | null => {
      let p = start;
      while (p + 8 <= stop) {
        let sz = be(p);
        let hdr = 8;
        const ty = str(p + 4, p + 8);
        if (sz === 1) {
          sz = be(p + 12);
          hdr = 16;
        } else if (sz === 0) sz = stop - p;
        if (sz < 8) return null;
        if (ty === path[0])
          return path.length === 1 ? [p + hdr, p + sz] : find(p + hdr + (ty === 'meta' ? 4 : 0), p + sz, path.slice(1));
        p += sz;
      }
      return null;
    };
    const ilst = find(0, u.length, ['moov', 'udta', 'meta', 'ilst']);
    if (ilst) {
      let p = ilst[0];
      const keys: Record<string, TagKey> = {
        '©nam': 'title',
        '©ART': 'artist',
        aART: 'artist',
        '©alb': 'album',
        '©day': 'year',
      };
      while (p + 8 <= ilst[1]) {
        const sz = be(p);
        if (sz < 8) break;
        const name = (u[p + 4] === 0xa9 ? '©' : String.fromCharCode(u[p + 4])) + str(p + 5, p + 8);
        const data = find(p + 8, p + sz, ['data']);
        if (data) {
          const payload = u.subarray(data[0] + 8, data[1]);
          if (keys[name]) set(keys[name], new TextDecoder('utf-8').decode(payload));
          else if (name === 'covr' && !out.pic)
            out.pic = { mime: (be(data[0]) & 0xffffff) === 14 ? 'image/png' : 'image/jpeg', data: payload };
        }
        p += sz;
      }
    }
  } else if (str(0, 4) === 'fLaC') {
    // FLAC metadata blocks
    let p = 4;
    let last = false;
    const le = (o: number): number => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
    const vorbis: Record<string, TagKey> = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', DATE: 'year' };
    while (!last && p + 4 <= u.length) {
      const h = u[p];
      const type = h & 0x7f;
      const len = (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3];
      const b = p + 4;
      last = !!(h & 0x80);
      p = b + len;
      if (type === 4) {
        let q = b + 4 + le(b);
        const n = le(q);
        q += 4;
        for (let i = 0; i < n && q < p; i++) {
          const cl = le(q);
          q += 4;
          const s = new TextDecoder('utf-8').decode(u.subarray(q, q + cl));
          q += cl;
          const eq = s.indexOf('=');
          if (eq > 0) set(vorbis[s.slice(0, eq).toUpperCase()], s.slice(eq + 1));
        }
      } else if (type === 6 && !out.pic) {
        let q = b + 4;
        const ml = be(q);
        q += 4;
        const mime = str(q, q + ml);
        q += ml;
        q += 4 + be(q) + 16;
        const pl = be(q);
        q += 4;
        out.pic = { mime: mime || 'image/jpeg', data: u.subarray(q, q + pl) };
      }
    }
  }
  if (!out.title && u.length >= 128 && str(u.length - 128, u.length - 125) === 'TAG') {
    // ID3v1 at the end of the file
    const o = u.length - 128;
    const field = (a: number, n: number): string => clean(decode(u.subarray(o + a, o + a + n), 0));
    out.title = field(3, 30);
    out.artist ||= field(33, 30);
    out.album ||= field(63, 30);
    out.year ||= field(93, 4);
  }
  if (out.year) out.year = String(out.year).slice(0, 4);
  for (const k of ['title', 'artist', 'album', 'year'] as const) if (out[k] === '') delete out[k];
  return out;
}

const READ_ALL_LIMIT = 32 * 1024 * 1024;
const HEAD_BYTES = 8 * 1024 * 1024;

/** Read tags from a file without loading huge files whole: head (8 MB) plus the ID3v1 tail. */
export async function readFileTags(file: Blob): Promise<Tags> {
  try {
    if (file.size <= READ_ALL_LIMIT) return parseTags(new Uint8Array(await file.arrayBuffer()));
    const tags = parseTags(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()));
    if (!tags.title) {
      const tail = parseTags(new Uint8Array(await file.slice(file.size - 128).arrayBuffer()));
      return { ...tail, ...tags };
    }
    return tags;
  } catch {
    return {};
  }
}

export interface GuessedMeta {
  artist: string;
  title: string;
  /** Cleaned file name, used as a free-text search query. */
  q: string;
}

/** Guess artist and title from a file name like "01 - Artist - Title (Official Audio).mp3". */
export function guessFromFilename(name: string): GuessedMeta {
  const s = String(name ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s*[([][^)\]]*(official|audio|video|lyric|hd|hq|remaster|visuali[sz]er)[^)\]]*[)\]]/gi, '')
    .replace(/^\d{1,3}\s*[-.]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = s.split(/\s+[-–—]\s+/);
  return parts.length >= 2
    ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), q: s }
    : { artist: '', title: s, q: s };
}
