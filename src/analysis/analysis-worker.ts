/**
 * Background track analysis, off the main thread. Pure DSP — no eval, no WASM — so, unlike the
 * Essentia mood worker (src/ai/mood-worker.js, scoped /workers/ CSP), it runs under the strict page
 * policy. It decodes nothing itself: the runner hands it the decoded mono signal and it returns the
 * beat grid, downbeats, energy curve, sections, drops, key and loudness. See docs/ROADMAP.md §2.2.
 *
 * Protocol (main -> worker): { type:'analyse', reqId, mono:Float32Array, sampleRate }
 *                 (worker -> main): { type:'result', reqId, result:ExtractResult }
 *                                   { type:'error',  reqId, message }
 */
import { analyseSignal, type ExtractResult } from './extract';

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
  result: ExtractResult;
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
  postMessage(msg: AnalysisWorkerOut, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const d = e.data;
  if (!d || d.type !== 'analyse') return;
  try {
    const result = analyseSignal(d.mono, d.sampleRate);
    // Transfer the big arrays back rather than copying them.
    ctx.postMessage({ type: 'result', reqId: d.reqId, result }, [result.beats.buffer, result.energy.buffer]);
  } catch (err) {
    ctx.postMessage({ type: 'error', reqId: d.reqId, message: String((err as Error)?.message ?? err) }, []);
  }
};
