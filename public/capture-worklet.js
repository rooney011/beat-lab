/*
 * Capture worklet for live sources (mic / tab). Buffers the mono input and posts it to the main
 * thread in ~8k-sample chunks, which the AI mood manager assembles into a rolling window. Produces
 * no output of its own, so it never adds sound to the mix.
 */
/* eslint-disable */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(8192);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
