/**
 * Offline analysis harness. Renders a fixture through an OfflineAudioContext, pausing every
 * 1/fps seconds (sample-accurate) to run the real analysis code exactly as the app does per frame.
 * Used by tests/e2e/analysis.spec.ts; served by the Vite dev server, never shipped.
 */
import { FeatureExtractor } from '../../src/analysis/features';
import { MoodReader } from '../../src/analysis/mood';
import { SyncDelay } from '../../src/analysis/sync';
import { createAnalysers } from '../../src/audio/engine';
import { Crew } from '../../src/render/layers/crew';

export interface ProbeRow {
  t: number;
  beat: boolean;
  strong: boolean;
  pulse: number;
  /** Peak string amplitude this frame. */
  amp: number;
  /** Mean per-point change of the string since last frame. */
  jit: number;
  /** Dancers' beat phase. */
  ph: number;
  /** A beat reached the picture this frame (after the sync delay). */
  shown: boolean;
}

export interface ProbeOptions {
  fps?: number;
  delayMs?: number;
  seconds?: number;
}

async function probe(url: string, opts: ProbeOptions = {}): Promise<ProbeRow[]> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bytes);
  const sr = audio.sampleRate;
  const dur = Math.min(audio.duration, opts.seconds ?? 19.5);
  const oc = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
  const src = oc.createBufferSource();
  src.buffer = audio;
  src.start(0);
  const features = new FeatureExtractor();
  features.attach(createAnalysers(oc, src), sr);
  const mood = new MoodReader();
  mood.reset('probe');
  const crew = new Crew();
  const sync = new SyncDelay();
  const rows: ProbeRow[] = [];
  let last = 0;
  let bpm = 0;
  let prevW: Float32Array | null = null;
  const quantum = 128 / sr;
  const step = 1 / (opts.fps ?? 60);
  for (let t = step; t < dur - 0.05; t += step) {
    const at = Math.round(t / quantum) * quantum;
    void oc.suspend(at).then(() => {
      const tt = oc.currentTime;
      const dt = Math.max(0.001, tt - last);
      last = tt;
      const T = tt * 1000;
      const a = features.update(T, dt, { live: true, playing: true, hasSource: true });
      const d = mood.observe(a.f, dt, T, features.spectrum);
      if (d) bpm = d.bpm;
      crew.updateClock(dt, T, a.f, { playing: true, live: true, clockBpm: mood.profile?.clockBpm ?? 0, bpm });
      const w = a.wave;
      let mx = 0;
      let dj = 0;
      for (let i = 0; i < w.length; i++) {
        mx = Math.max(mx, Math.abs(w[i]));
        if (prevW) dj += Math.abs(w[i] - prevW[i]);
      }
      prevW = Float32Array.from(w);
      const row: ProbeRow = {
        t: tt,
        beat: a.f.beat,
        strong: a.f.strong,
        pulse: a.f.pulse,
        amp: mx,
        jit: dj / w.length,
        ph: crew.ph,
        shown: false,
      };
      row.shown = sync.apply(a, T, opts.delayMs ?? 0).f.beat;
      rows.push(row);
      void oc.resume();
    });
  }
  await oc.startRendering();
  return rows;
}

(window as unknown as { probe: typeof probe }).probe = probe;
