import { describe, expect, it } from 'vitest';
import { clipBitrate, clipFileName, clipSize, extForType, isWebm, pickMimeType } from '../../src/clip/format';

describe('pickMimeType', () => {
  it('prefers MP4 H.264/AAC when supported', () => {
    expect(pickMimeType(() => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });

  it('falls back to WebM when only WebM is supported (Firefox)', () => {
    const type = pickMimeType((t) => t.includes('webm'));
    expect(type).toBe('video/webm;codecs=vp9,opus');
  });

  it('returns an empty string when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBe('');
  });
});

describe('extForType / isWebm', () => {
  it('maps containers to extensions', () => {
    expect(extForType('video/mp4;codecs=avc1.42E01E,mp4a.40.2')).toBe('mp4');
    expect(extForType('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extForType('')).toBe('webm');
  });
  it('flags WebM', () => {
    expect(isWebm('video/webm')).toBe(true);
    expect(isWebm('video/mp4')).toBe(false);
  });
});

describe('clipSize / clipBitrate', () => {
  it('is 1080×1920 on desktop, 720×1280 on phone (9:16)', () => {
    expect(clipSize('9:16', 'desktop')).toEqual({ w: 1080, h: 1920 });
    expect(clipSize('9:16', 'mobile')).toEqual({ w: 720, h: 1280 });
    expect(clipSize('9:16', 'tablet')).toEqual({ w: 1080, h: 1920 });
  });
  it('is square for 1:1', () => {
    expect(clipSize('1:1', 'desktop')).toEqual({ w: 1080, h: 1080 });
    expect(clipSize('1:1', 'mobile')).toEqual({ w: 720, h: 720 });
  });
  it('scales bitrate with size', () => {
    expect(clipBitrate({ w: 1080, h: 1920 })).toBe(8_000_000);
    expect(clipBitrate({ w: 720, h: 1280 })).toBe(5_000_000);
  });
});

describe('clipFileName', () => {
  const date = new Date('2026-03-04T12:00:00Z');
  it('slugs the song and dates the file', () => {
    expect(clipFileName('Midnight Signal', date, 'video/mp4')).toBe('beatlab-midnight-signal-2026-03-04.mp4');
  });
  it('handles messy titles and WebM', () => {
    expect(clipFileName('  Déjà-Vu!! (Remix) ', date, 'video/webm')).toBe('beatlab-d-j-vu-remix-2026-03-04.webm');
  });
  it('falls back to "clip" when the title is empty', () => {
    expect(clipFileName('', date, 'video/mp4')).toBe('beatlab-clip-2026-03-04.mp4');
  });
});
