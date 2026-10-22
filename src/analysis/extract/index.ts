/**
 * The offline analysis pipeline: decoded mono signal in, the per-track result out. Runs in the
 * analysis worker (src/analysis/analysis-worker.ts). Pure and deterministic end to end, so the
 * synthetic-audio unit tests pin exact numbers. See docs/ROADMAP.md §2.2.
 */
import { measureLoudness, type LoudnessResult } from '../../library/loudness';
import type { AnalysisDrop, AnalysisKey, AnalysisSection } from '../../library/types';
import { detectKey } from './key';
import { beatStrength, detectDownbeat, estimateTempo, onsetEnvelope, trackBeats } from './rhythm';
import { computeSpectrogram } from './spectral';
import { energyCurve, structure } from './structure';

export interface ExtractResult {
  bpm: number;
  beatConfidence: number;
  beats: Float32Array;
  firstDownbeat: number;
  energy: Uint8Array;
  sections: AnalysisSection[];
  drops: AnalysisDrop[];
  key?: AnalysisKey;
  loudness: LoudnessResult;
}

/** Full extraction on a mono signal at `sr` (the runner decodes to 22.05 kHz). */
export function analyseSignal(mono: Float32Array, sr: number): ExtractResult {
  const spec = computeSpectrogram(mono, sr);
  const onset = onsetEnvelope(spec);
  const tempo = estimateTempo(onset, spec.fps);
  const beats = trackBeats(onset, spec.fps, tempo.bpm);
  const strength = beatStrength(onset, beats, spec.fps);
  const beatConfidence = Math.max(0, Math.min(1, 0.5 * tempo.confidence + 0.5 * strength));
  const firstDownbeat = detectDownbeat(spec, beats);
  const energy = energyCurve(spec, beats);
  const { sections, drops } = structure(spec, beats, energy, firstDownbeat);
  const key = detectKey(spec);
  const loudness = measureLoudness([mono], sr);
  return { bpm: tempo.bpm, beatConfidence, beats, firstDownbeat, energy, sections, drops, key, loudness };
}
