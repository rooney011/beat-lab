/**
 * Background track analysis, off the main thread. Pure DSP — no eval, no WASM — so, unlike the
 * Essentia mood worker (src/ai/mood-worker.js, scoped /workers/ CSP), it runs under the strict page
 * policy as an ordinary bundled module worker. Milestone 2.1 computes loudness from the decoded mono
 * signal; 2.2 adds the beat grid, downbeats, energy curve, sections, drops and key here, on the same
 * input. See docs/ROADMAP.md §Phase 2.
 *
 * Protocol (main -> worker): { type:'analyse', reqId, mono:Float32Array, sampleRate }
 *                 (worker -> main): { type:'result', reqId, loudness:{lufs,peak} }
 *                                   { type:'error',  reqId, message }
 */
import { measureLoudness, type LoudnessResult } from '../library/loudness';

export interface AnalyseRequest {
  type: 'analyse';
  reqId: number;
  /** Decoded, down-mixed mono signal. */
  mono: Float32Array;
  /** Sample rate of `mono` (the runner decodes to 22 050 Hz). */
  sampleRate: number;
}

export interface AnalysisResultMsg {
  type: 'result';
  reqId: number;
  loudness: LoudnessResult;
}

export interface AnalysisErrorMsg {
  type: 'error';
  reqId: number;
  message: string;
}

export type AnalysisWorkerOut = AnalysisResultMsg | AnalysisErrorMsg;

// The tsconfig uses the DOM lib (not webworker), so `self` is typed as a Window. Cast to the minimal
// worker surface we use, which also avoids DOM's targetOrigin-flavoured postMessage signature.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<AnalyseRequest>) => void) | null;
  postMessage(msg: AnalysisWorkerOut): void;
};

ctx.onmessage = (e) => {
  const d = e.data;
  if (!d || d.type !== 'analyse') return;
  try {
    // Loudness on the mono 22.05 kHz decode: a down-mix is within the ±1 LU playback target for
    // -14 LUFS levelling, and it reuses the single decode the 2.2 extraction will share.
    const loudness = measureLoudness([d.mono], d.sampleRate);
    ctx.postMessage({ type: 'result', reqId: d.reqId, loudness });
  } catch (err) {
    ctx.postMessage({ type: 'error', reqId: d.reqId, message: String((err as Error)?.message ?? err) });
  }
};
