/**
 * Pure helpers for clip recording (docs/ROADMAP.md §3.1): choosing a shareable container/codec, the
 * clip's pixel size, and the download file name. Kept free of DOM/MediaRecorder so they're unit-tested;
 * `ClipStudio` wires them to the real APIs.
 */
import type { Layout } from '../types';

export type ClipAspect = '9:16' | '1:1';

/**
 * Candidate recording types, most shareable first. Safari records MP4; Chrome can too but H.264/AAC
 * depend on the OS (audio may fall back to Opus); Firefox only does WebM. `ClipStudio` passes
 * `MediaRecorder.isTypeSupported` and takes the first that's accepted (or '' — let the browser decide).
 */
export const CLIP_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const;

export function pickMimeType(isSupported: (type: string) => boolean): string {
  for (const t of CLIP_TYPES) if (isSupported(t)) return t;
  return '';
}

/** `.mp4` for any MP4 type, `.webm` for WebM, else a generic `.webm`. */
export function extForType(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'webm';
}

/** WebM won't post to some social apps — tell the user when that's what they got. */
export function isWebm(mime: string): boolean {
  return mime.includes('webm');
}

/** Clip pixel size: portrait 9:16 or square, smaller on phones to keep real-time encoding affordable. */
export function clipSize(aspect: ClipAspect, layout: Layout): { w: number; h: number } {
  const phone = layout === 'mobile';
  if (aspect === '1:1') {
    const s = phone ? 720 : 1080;
    return { w: s, h: s };
  }
  return phone ? { w: 720, h: 1280 } : { w: 1080, h: 1920 };
}

/** Target bitrate for the recorder (~8 Mbps at 1080×1920, ~5 Mbps at 720×1280). */
export function clipBitrate(size: { w: number; h: number }): number {
  return size.h >= 1920 ? 8_000_000 : 5_000_000;
}

/** `beatlab-<slug>-<yyyy-mm-dd>.<ext>`; `song` is slugged to lowercase dash-separated alphanumerics. */
export function clipFileName(song: string, date: Date, mime: string): string {
  const slug =
    song
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'clip';
  const d = date.toISOString().slice(0, 10);
  return `beatlab-${slug}-${d}.${extForType(mime)}`;
}
