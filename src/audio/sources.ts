/** Audio sources that feed the analysis input: a local file, the microphone, or a shared browser tab. */

export class FileSource {
  readonly el: HTMLAudioElement;
  private readonly node: MediaElementAudioSourceNode;
  private readonly url: string;
  onEnded: (() => void) | null = null;
  onError: (() => void) | null = null;

  constructor(ctx: AudioContext, file: File, out: AudioNode) {
    this.url = URL.createObjectURL(file);
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.src = this.url;
    this.el.addEventListener('ended', () => this.onEnded?.());
    this.el.addEventListener('error', () => this.onError?.());
    this.node = ctx.createMediaElementSource(this.el);
    this.node.connect(out);
  }

  /** Resolves with the duration once metadata is known (0 if it never arrives). */
  duration(): Promise<number> {
    if (Number.isFinite(this.el.duration) && this.el.duration > 0) return Promise.resolve(this.el.duration);
    return new Promise((resolve) => {
      const done = () => resolve(Number.isFinite(this.el.duration) ? this.el.duration : 0);
      this.el.addEventListener('loadedmetadata', done, { once: true });
      this.el.addEventListener('error', () => resolve(0), { once: true });
    });
  }

  play(): Promise<void> {
    return this.el.play();
  }

  pause(): void {
    this.el.pause();
  }

  get paused(): boolean {
    return this.el.paused;
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  set currentTime(v: number) {
    try {
      this.el.currentTime = v;
    } catch {}
  }

  dispose(): void {
    this.onEnded = null;
    this.onError = null;
    try {
      this.el.pause();
    } catch {}
    try {
      this.node.disconnect();
    } catch {}
    this.el.removeAttribute('src');
    this.el.load();
    URL.revokeObjectURL(this.url);
  }
}

export type LiveKind = 'mic' | 'tab';

export type LiveError = 'denied' | 'missing' | 'no-audio' | 'unsupported' | 'cancelled' | 'failed';

export class LiveSourceError extends Error {
  constructor(readonly code: LiveError) {
    super(code);
  }
}

/** Microphone or tab capture. Never routed to the speakers. */
export class LiveSource {
  private readonly node: MediaStreamAudioSourceNode;
  onEnded: (() => void) | null = null;

  private constructor(
    readonly kind: LiveKind,
    private readonly stream: MediaStream,
    ctx: AudioContext,
    out: AudioNode,
  ) {
    this.node = ctx.createMediaStreamSource(stream);
    this.node.connect(out);
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => this.onEnded?.());
  }

  static async mic(ctx: AudioContext, out: AudioNode): Promise<LiveSource> {
    if (!navigator.mediaDevices?.getUserMedia) throw new LiveSourceError('unsupported');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      return new LiveSource('mic', stream, ctx, out);
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new LiveSourceError('denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new LiveSourceError('missing');
      throw new LiveSourceError('failed');
    }
  }

  static async tab(ctx: AudioContext, out: AudioNode): Promise<LiveSource> {
    if (!LiveSource.tabSupported()) throw new LiveSourceError('unsupported');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chromium-only hints; ignored elsewhere.
        ...({ preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include' } as object),
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      throw new LiveSourceError(name === 'NotAllowedError' || name === 'AbortError' ? 'cancelled' : 'failed');
    }
    // Only the audio is needed; drop the video so the capture costs nothing to keep alive.
    for (const v of stream.getVideoTracks()) v.stop();
    if (!stream.getAudioTracks().length) {
      for (const t of stream.getTracks()) t.stop();
      throw new LiveSourceError('no-audio');
    }
    return new LiveSource('tab', stream, ctx, out);
  }

  /** Tab audio capture works in Chromium-based desktop browsers. */
  static tabSupported(): boolean {
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; mobile?: boolean } })
      .userAgentData;
    if (brands?.mobile) return false;
    if (brands?.brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))) return true;
    return /Chrome\//.test(navigator.userAgent) && !/Mobile|Android/.test(navigator.userAgent);
  }

  get label(): string {
    return this.stream.getAudioTracks()[0]?.label ?? '';
  }

  dispose(): void {
    this.onEnded = null;
    try {
      this.node.disconnect();
    } catch {}
    for (const t of this.stream.getTracks()) t.stop();
  }
}
