import { MAX_DELAY_MS } from './analysis/sync';
import type { AppState, FxFlags } from './types';

const KEY = 'beat-lab:settings:v1';

/** Settings that survive a reload. Everything else starts fresh. */
export const PERSISTED = [
  'dose',
  'motion',
  'strict',
  'fx',
  'syncMs',
  'quality',
  'autoHide',
  'shortcuts',
  'lyricsOnline',
  'aiMood',
  'coverColours',
] as const;
type PersistedKey = (typeof PERSISTED)[number];
export type Persisted = Pick<AppState, PersistedKey>;

export function loadSettings(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of PERSISTED) if (k in data) out[k] = data[k];
    return out as Partial<Persisted>;
  } catch {
    return {};
  }
}

export function saveSettings(s: AppState): void {
  try {
    const out: Record<string, unknown> = {};
    for (const k of PERSISTED) out[k] = s[k];
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {}
}

export function settingsChanged(a: AppState, b: AppState): boolean {
  return PERSISTED.some((k) => a[k] !== b[k]);
}

export const DEFAULT_FX: FxFlags = {
  cuts: true,
  plates: true,
  letters: true,
  stamps: true,
  lyrics: true,
  dancers: true,
  glitch: true,
  grain: true,
};

/** Accept only well-formed values from storage; anything else falls back to defaults. */
export function sanitize(p: Partial<Persisted>): Partial<Persisted> {
  const out: Partial<Persisted> = {};
  if (typeof p.dose === 'number' && p.dose >= 0 && p.dose <= 100) out.dose = Math.round(p.dose / 5) * 5;
  if (p.motion === 'system' || p.motion === 'on' || p.motion === 'off') out.motion = p.motion;
  if (typeof p.strict === 'boolean') out.strict = p.strict;
  if (p.fx && typeof p.fx === 'object')
    out.fx = {
      ...DEFAULT_FX,
      ...Object.fromEntries(Object.entries(p.fx).filter(([k, v]) => k in DEFAULT_FX && typeof v === 'boolean')),
    };
  if (p.syncMs === null || (typeof p.syncMs === 'number' && p.syncMs >= 0 && p.syncMs <= MAX_DELAY_MS))
    out.syncMs = p.syncMs;
  if (p.quality === 'auto' || p.quality === 'high' || p.quality === 'low') out.quality = p.quality;
  for (const k of ['autoHide', 'shortcuts', 'lyricsOnline', 'aiMood', 'coverColours'] as const)
    if (typeof p[k] === 'boolean') out[k] = p[k];
  return out;
}
