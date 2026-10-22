/**
 * Scene Lab: preview every background scene against a simulated beat or a real song, with the
 * song's look (mood, energy, brightness, tempo, cover colours) under your control.
 * Dev tool only: `npm run dev`, then open /tools/scene-lab/.
 */
import { FeatureExtractor } from '../../src/analysis/features';
import { analyseSignal } from '../../src/analysis/extract';
import { beatTolerance, matchEvents, scoreTempo } from '../../src/analysis/metrics';
import { createAnalysers } from '../../src/audio/engine';
import { downsampleTo, toMono } from '../../src/ai/resample';
import { DIMS, LAYERS } from '../../src/config/dims';
import { MOODS } from '../../src/config/moods';
import type { DrawContext } from '../../src/render/context';
import { Burst } from '../../src/render/layers/burst';
import { Rings } from '../../src/render/layers/rings';
import { drawString } from '../../src/render/layers/string';
import { Patterns } from '../../src/render/patterns';
import { FlashBudget } from '../../src/render/safety';
import {
  LookTracker,
  SCENES,
  SceneDirector,
  extractPalette,
  pixelsOf,
  scenesFor,
  tintDim,
} from '../../src/render/scenes';
import type { CoverPalette, SceneId } from '../../src/render/scenes';
import type { Analysis, Features, MoodId } from '../../src/types';
import { ListeningOrb } from '../../src/ui/listening-orb';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------- simulated beat

/** A stand-in for live analysis: kicks on every beat, snares on 2 and 4, hats on the eighths. */
class SimBeat {
  readonly f: Features = {
    beat: false,
    strong: false,
    snare: false,
    replaced: false,
    spark: 0,
    pulse: 0,
    mids: 0,
    highs: 0,
    intensity: 0.5,
    db: -12,
    silent: false,
    bands: new Float32Array(8),
  };
  readonly bars = new Float32Array(48);
  readonly peaks = new Float32Array(48);
  readonly wave = new Float32Array(160);
  private lastBeat = -1;
  private lastEighth = -1;
  private snareAt = -1;
  private kickEnv = 0;
  private snareEnv = 0;
  private hatEnv = 0;
  private pluck = 0;
  private ph = 0;
  private start = performance.now();

  update(t: number, dt: number, bpm: number, energy: number): Analysis {
    const f = this.f;
    f.beat = f.strong = f.snare = false;
    f.spark = 0;
    const pos = ((t - this.start) / 1000) * (bpm / 60);
    const beat = Math.floor(pos);
    const eighth = Math.floor(pos * 2);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      f.beat = true;
      f.strong = beat % 4 === 0;
      this.kickEnv = 1;
      this.pluck = f.strong ? 1 : 0.7;
      this.ph = 0;
      if (beat % 2 === 1) this.snareAt = t + 30;
    }
    if (this.snareAt > 0 && t >= this.snareAt) {
      f.snare = true;
      this.snareEnv = 1;
      this.snareAt = -1;
    }
    if (eighth !== this.lastEighth) {
      this.lastEighth = eighth;
      f.spark = 2 + Math.round(energy * 3);
      this.hatEnv = 1;
    }
    const decay = (v: number, s: number): number => v * Math.exp(-dt / s);
    this.kickEnv = decay(this.kickEnv, 0.12);
    this.snareEnv = decay(this.snareEnv, 0.1);
    this.hatEnv = decay(this.hatEnv, 0.05);
    this.pluck = decay(this.pluck, 0.15);
    f.pulse = Math.max(this.kickEnv, 0.1);
    f.mids = 0.25 + 0.6 * this.snareEnv;
    f.highs = 0.2 + 0.6 * this.hatEnv * energy;
    f.intensity = 0.25 + 0.65 * energy + 0.05 * Math.sin(t * 0.0007);
    for (let i = 0; i < 8; i++)
      f.bands[i] = i < 2 ? 0.3 + 0.7 * this.kickEnv : i < 5 ? 0.25 + 0.6 * this.snareEnv : 0.15 + 0.7 * this.hatEnv;
    for (let i = 0; i < 48; i++) {
      const low = i < 10 ? this.kickEnv * (1 - i / 12) : 0;
      const mid = i >= 10 && i < 28 ? this.snareEnv * 0.7 : 0;
      const high = i >= 28 ? this.hatEnv * 0.6 : 0;
      const v = Math.min(1, (0.12 + 0.18 * energy) * (1 - i / 70) + low + mid + high + 0.06 * Math.sin(t * 0.003 + i));
      this.bars[i] = v > this.bars[i] ? v : Math.max(0, this.bars[i] - dt * 1.6);
      this.peaks[i] = Math.max(this.bars[i], this.peaks[i] - dt * 0.6);
    }
    this.ph += dt;
    const n = this.wave.length;
    for (let i = 0; i < n; i++) {
      const env = Math.sin((Math.PI * i) / (n - 1));
      this.wave[i] =
        env *
        (0.12 + 0.9 * this.pluck) *
        Math.cos(this.ph * 2 * Math.PI * 4 + i * 0.02) *
        (0.5 + 0.5 * Math.sin((i / n) * Math.PI * 3));
    }
    return { f, bars: this.bars, peaks: this.peaks, wave: this.wave };
  }
}

// ---------------------------------------------------------------- real song

class SongInput {
  private ctx: AudioContext | null = null;
  private el: HTMLAudioElement | null = null;
  private url = '';
  private readonly fx = new FeatureExtractor();
  /** The loaded file, so the annotate mode can decode and analyse it for scoring. */
  file: File | null = null;

  get playing(): boolean {
    return !!this.el && !this.el.paused;
  }

  /** Current playback position in seconds (0 when nothing is loaded) — the annotation timestamp. */
  get currentTime(): number {
    return this.el?.currentTime ?? 0;
  }

  /** Decode the loaded file to mono at 22.05 kHz (the analysis rate) for offline scoring. */
  async decodeMono(): Promise<{ mono: Float32Array; sr: number } | null> {
    if (!this.file || !this.ctx) return null;
    const buf = await this.ctx.decodeAudioData(await this.file.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    return { mono: downsampleTo(toMono(channels), buf.sampleRate, 22_050), sr: 22_050 };
  }

  async load(file: File): Promise<void> {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stop();
    this.file = file;
    this.url = URL.createObjectURL(file);
    this.el = new Audio(this.url);
    const src = this.ctx.createMediaElementSource(this.el);
    const input = this.ctx.createGain();
    src.connect(input);
    input.connect(this.ctx.destination);
    this.fx.attach(createAnalysers(this.ctx, input), this.ctx.sampleRate);
    this.fx.newSong();
    await this.el.play();
  }

  toggle(): void {
    if (!this.el) return;
    if (this.el.paused) void this.el.play();
    else this.el.pause();
  }

  stop(): void {
    this.el?.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.el = null;
    this.url = '';
  }

  update(t: number, dt: number): Analysis {
    const live = this.playing && this.ctx?.state === 'running';
    return this.fx.update(t, dt, { live, playing: live, hasSource: true });
  }
}

// ---------------------------------------------------------------- sample covers

const COVERS: { name: string; paint: (c: CanvasRenderingContext2D, s: number) => void }[] = [
  {
    name: 'Sunset',
    paint: (c, s) => {
      const g = c.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#FF6A3D');
      g.addColorStop(0.55, '#F2C14E');
      g.addColorStop(1, '#5B2A86');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#2B1240';
      c.fillRect(0, s * 0.75, s, s * 0.25);
    },
  },
  {
    name: 'Ocean',
    paint: (c, s) => {
      c.fillStyle = '#0C3B5E';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#1FA2C2';
      c.beginPath();
      c.arc(s * 0.5, s * 0.6, s * 0.35, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#E9F5F2';
      c.fillRect(0, s * 0.8, s, s * 0.05);
    },
  },
  {
    name: 'Neon',
    paint: (c, s) => {
      c.fillStyle = '#120A1F';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#39FF88';
      c.fillRect(s * 0.1, s * 0.1, s * 0.3, s * 0.8);
      c.fillStyle = '#FF2BD6';
      c.fillRect(s * 0.55, s * 0.2, s * 0.3, s * 0.6);
    },
  },
  {
    name: 'Forest',
    paint: (c, s) => {
      c.fillStyle = '#1E3B1E';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#7FB241';
      c.beginPath();
      c.moveTo(s * 0.5, s * 0.1);
      c.lineTo(s * 0.85, s * 0.85);
      c.lineTo(s * 0.15, s * 0.85);
      c.fill();
      c.fillStyle = '#D9A441';
      c.fillRect(s * 0.44, s * 0.85, s * 0.12, s * 0.15);
    },
  },
];

// ---------------------------------------------------------------- lab state

const MOOD_ORDER: (MoodId | null)[] = [null, 'hype', 'grit', 'dreamy', 'brooding'];
const moodName = (m: MoodId | null): string => (m ? MOODS[m].label : 'LISTENING');
/** How long the lab pretends the mood read takes after a new song. */
const READ_MS = 6000;
/** Which dimensions show each slot of a song's set (see sceneIndexForDim). */
const SLOT_LABELS = ['Inkfall + Riso Heat', 'Pressline', 'Static Bloom'];

const lab = {
  mood: 'hype' as MoodId | null,
  auto: true,
  scene: 'speedlines' as SceneId,
  dim: 2,
  energy: 0.75,
  brightness: 0.7,
  bpm: 124,
  dose: 0.7,
  strength: 1,
  calm: false,
  layers: true,
  palette: null as CoverPalette | null,
  coverName: 'None',
  song: 1,
  source: 'sim' as 'sim' | 'file',
  /** While > 0, the mood is "being read" until this time: the listening globe plays. */
  readUntil: 0,
};

const reading = (): boolean => lab.readUntil > 0;

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
const pat = new Patterns(ctx);
const tracker = new LookTracker(`lab-song-${lab.song}`);
const director = new SceneDirector(tracker.look);
const sim = new SimBeat();
const song = new SongInput();
const rings = new Rings();
const burst = new Burst();
const flashes = new FlashBudget();
const jit = new Float32Array(40);
const envelope = new Float32Array(160).map((_, i) => Math.sin((Math.PI * i) / 159));
let kick = 0;
let last = performance.now();
let frameMs = 16;
let jitFrame = 0;
const orb = new ListeningOrb(16);
$('orbSlot').append(orb.el);

function applyMood(t: number): void {
  tracker.setMood(lab.energy, lab.brightness, lab.bpm);
  director.setMood(reading() ? null : lab.mood, t);
  director.setDim(lab.dim, t);
  director.pin(lab.auto ? null : lab.scene, t);
}

function newSong(): void {
  const t = performance.now();
  lab.song++;
  director.setSong(tracker.reset(`lab-song-${lab.song}`), t);
  tracker.setPalette(lab.palette);
  startReading(t);
}

/** Pretend to read the new song's mood: the listening globe plays, then the mood's set takes over. */
function startReading(t: number): void {
  lab.readUntil = t + READ_MS;
  applyMood(t);
  render();
}

// ---------------------------------------------------------------- drawing

function resize(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const W = Math.max(4, Math.round(r.width * dpr));
  const H = Math.max(4, Math.round(r.height * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
}

function frame(t: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
  last = t;
  frameMs += (dt * 1000 - frameMs) * 0.05;
  resize();
  tracker.update(dt);
  if (reading() && t >= lab.readUntil) {
    lab.readUntil = 0;
    applyMood(t);
    render();
  }
  const a = lab.source === 'file' ? song.update(t, dt) : sim.update(t, dt, lab.bpm, lab.energy);
  if (reading()) orb.draw(t, a.bars, '#F3EEE3', lab.calm);
  const f = a.f;
  const W = canvas.width;
  const H = canvas.height;
  const k = Math.min(window.devicePixelRatio || 1, 1.5);
  const mob = W / k < 768;
  const md = Math.min(W, H);
  const cx = W * (mob ? 0.5 : 0.56);
  const cy = H * (mob ? 0.4 : 0.44);
  const calm = lab.calm;
  const D0 = DIMS[lab.dim];
  const D = lab.palette ? tintDim(D0, lab.palette, lab.dim === 0 ? 0.35 : 0.6) : D0;
  const tr = Math.pow(lab.dose, 1.4) * 1.25;
  if (f.beat) {
    kick = 1;
    if (!calm && LAYERS[lab.dim].rings) rings.spawn(t, f.strong);
  }
  kick = Math.max(0, kick - dt / 0.16);
  jitFrame = (jitFrame + 1) % 3;
  if (!jitFrame) for (let i = 0; i < jit.length; i++) jit[i] = Math.random() * 2 - 1;
  const off =
    (calm ? Math.min(3, 1 + f.highs * 2) : 2 + kick * (4 + 6 * tr) + f.highs * 12 * tr) *
    k *
    (D.id === 'riso' ? 1.6 : 1);
  const R = md * (mob ? 0.2 : 0.16) * (1 + f.pulse * 0.1 * (0.5 + lab.dose));
  const dc: DrawContext = {
    c: ctx,
    W,
    H,
    k,
    md,
    cx,
    cy,
    R,
    off,
    dose: lab.dose,
    tr,
    calm,
    mob,
    t,
    dt,
    D,
    dim: lab.dim,
    a,
    f,
    pat,
    jit,
    motion: calm ? 0.35 : lab.mood ? MOODS[lab.mood].motion : 1,
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = D.stage;
  ctx.fillRect(0, 0, W, H);
  // Same background strength the app uses: per-dimension base × beat breathing × layer budget.
  const base = [0.14, 0.22, 0.24, 0.18][lab.dim] * (0.75 + 0.5 * f.pulse) * LAYERS[lab.dim].bg * lab.strength;
  director.draw({ dc, alpha: base, kick, rings: rings.list, flash: () => !calm && flashes.take(t, false) }, t);
  if (lab.layers) {
    drawString(dc, envelope);
    if (!calm) rings.draw(dc);
    burst.draw(dc);
  }
  const vg = ctx.createRadialGradient(cx, cy, md * 0.3, cx, cy, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(5,4,8,0)');
  vg.addColorStop(1, 'rgba(5,4,8,0.7)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- controls

function button(
  label: string,
  opts: { pressed?: boolean; onClick: () => void; cls?: string; title?: string },
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (opts.cls) b.className = opts.cls;
  if (opts.title) b.title = opts.title;
  if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
  b.addEventListener('click', opts.onClick);
  return b;
}

function render(): void {
  const t = performance.now();
  // Mood tabs
  const moods = $('moods');
  moods.replaceChildren(
    ...MOOD_ORDER.map((m) =>
      button(moodName(m), {
        pressed: (reading() ? null : lab.mood) === m,
        onClick: () => {
          lab.mood = m;
          lab.readUntil = 0;
          const first = scenesFor(m)[0];
          if (!lab.auto && first) lab.scene = first.id;
          applyMood(t);
          render();
        },
      }),
    ),
  );
  // Scene list for the mood
  const list = $('scenes');
  const set = director.sceneIds;
  list.replaceChildren(
    ...scenesFor(reading() ? null : lab.mood).map((s) => {
      const li = document.createElement('li');
      const b = button(s.name, {
        pressed: !lab.auto && lab.scene === s.id,
        cls: 'scene',
        onClick: () => {
          lab.auto = false;
          lab.scene = s.id;
          applyMood(performance.now());
          render();
        },
      });
      const p = document.createElement('p');
      p.textContent = s.blurb;
      const slot = set.indexOf(s.id);
      const tag = document.createElement('span');
      tag.className = 'slot';
      tag.textContent = slot < 0 ? 'Not in rotation' : set.length === 1 ? 'Every dimension' : (SLOT_LABELS[slot] ?? '');
      li.append(b, tag, p);
      if (director.current === s.id) li.classList.add('is-live');
      return li;
    }),
  );
  const autoBtn = $<HTMLButtonElement>('auto');
  autoBtn.setAttribute('aria-checked', String(lab.auto));
  // Dimension
  $('dims').replaceChildren(
    ...DIMS.map((d, i) =>
      button(d.name, {
        pressed: lab.dim === i,
        onClick: () => {
          lab.dim = i;
          applyMood(performance.now());
          render();
        },
      }),
    ),
  );
  // Readouts
  const def = SCENES.find((s) => s.id === director.current);
  $('nowScene').textContent = def ? def.name : '';
  $('nowMood').textContent = `${moodName(reading() ? null : lab.mood)} · ${DIMS[lab.dim].name}`;
  $('reading').hidden = !reading();
  $('nowSet').textContent = set.map((id) => SCENES.find((s) => s.id === id)?.name ?? id).join(' → ');
  for (const id of ['energy', 'brightness', 'bpm', 'dose', 'strength'] as const) {
    const v = lab[id];
    $(`${id}Val`).textContent = id === 'bpm' ? `${v}` : id === 'strength' ? `${v.toFixed(1)}×` : v.toFixed(2);
  }
  $('calm').setAttribute('aria-checked', String(lab.calm));
  $('layers').setAttribute('aria-checked', String(lab.layers));
  // Covers
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#covers button')))
    b.setAttribute('aria-pressed', String(b.dataset.name === lab.coverName));
  const inks = $('inks');
  inks.replaceChildren(
    ...(lab.palette ? [...lab.palette.inks, lab.palette.stage] : DIMS[lab.dim].plates).map((c) => {
      const i = document.createElement('i');
      i.style.background = c;
      i.title = c;
      return i;
    }),
  );
  $('inksLabel').textContent = lab.palette ? `Inks from “${lab.coverName}”` : 'Dimension’s own inks';
  $('srcSim').setAttribute('aria-pressed', String(lab.source === 'sim'));
  $('srcFile').setAttribute('aria-pressed', String(lab.source === 'file'));
  $('playPause').hidden = lab.source !== 'file';
}

function setPalette(name: string, p: CoverPalette | null): void {
  lab.coverName = name;
  lab.palette = p;
  tracker.setPalette(p);
  render();
}

function buildCovers(): void {
  const host = $('covers');
  host.append(button('None', { cls: 'cover none', onClick: () => setPalette('None', null) }));
  (host.lastElementChild as HTMLElement).dataset.name = 'None';
  for (const cv of COVERS) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    cv.paint(x, 96);
    const b = button('', {
      cls: 'cover',
      title: cv.name,
      onClick: () => {
        const px = pixelsOf(c);
        setPalette(cv.name, px ? extractPalette(px) : null);
      },
    });
    b.dataset.name = cv.name;
    b.setAttribute('aria-label', `${cv.name} sample cover`);
    b.append(c);
    host.append(b);
  }
}

function slider(id: 'energy' | 'brightness' | 'bpm' | 'dose' | 'strength'): void {
  const el = $<HTMLInputElement>(id);
  el.value = String(lab[id]);
  el.addEventListener('input', () => {
    lab[id] = Number(el.value);
    if (id === 'energy' || id === 'brightness' || id === 'bpm') tracker.setMood(lab.energy, lab.brightness, lab.bpm);
    render();
  });
}

function bind(): void {
  (['energy', 'brightness', 'bpm', 'dose', 'strength'] as const).forEach(slider);
  $('auto').addEventListener('click', () => {
    lab.auto = !lab.auto;
    applyMood(performance.now());
    render();
  });
  $('calm').addEventListener('click', () => {
    lab.calm = !lab.calm;
    render();
  });
  $('layers').addEventListener('click', () => {
    lab.layers = !lab.layers;
    render();
  });
  $('newSong').addEventListener('click', newSong);
  $('coverFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const px = pixelsOf(bmp);
      const p = px ? extractPalette(px) : null;
      setPalette(file.name.replace(/\.[^.]+$/, ''), p);
      if (!p) $('inksLabel').textContent = 'That image is nearly greyscale, so the dimension keeps its own inks';
    } catch {
      $('inksLabel').textContent = "Couldn't read that image";
    }
  });
  $('srcSim').addEventListener('click', () => {
    song.stop();
    lab.source = 'sim';
    $('songStatus').textContent = 'Simulated beat at the tempo above.';
    render();
  });
  $('srcFile').addEventListener('click', () => $('songFile').click());
  $('songFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await song.load(file);
      lab.source = 'file';
      $('songStatus').textContent =
        `Playing ${file.name}. Beats come from the real detector; mood and energy are still set by hand.`;
    } catch {
      $('songStatus').textContent = "Couldn't play that file. Try MP3, M4A, WAV, OGG or FLAC.";
    }
    render();
  });
  $('playPause').addEventListener('click', () => song.toggle());

  // ---- annotate mode (validation, docs/analysis-results.md): tap D/S while a song plays, export the
  // annotation, and Score it against the real analyser. See docs/ROADMAP.md §2 Validation.
  const annot = { on: false, drops: [] as number[], sections: [] as number[] };
  const annotOut = $('annotOut');
  const inputTag = (e: Event): boolean => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  };
  const summary = (): void => {
    annotOut.textContent = `${annot.drops.length} drop(s), ${annot.sections.length} section(s) marked.`;
  };
  const mark = (kind: 'drop' | 'section'): void => {
    if (!song.playing) {
      annotOut.textContent = 'Play a song first, then mark drops (D) and sections (S).';
      return;
    }
    (kind === 'drop' ? annot.drops : annot.sections).push(Math.round(song.currentTime * 100) / 100);
    summary();
  };
  $('annotate').addEventListener('click', () => {
    annot.on = !annot.on;
    const b = $('annotate');
    b.setAttribute('aria-checked', String(annot.on));
    b.textContent = annot.on ? 'On' : 'Off';
  });
  $('markDrop').addEventListener('click', () => mark('drop'));
  $('markSection').addEventListener('click', () => mark('section'));
  $('annotClear').addEventListener('click', () => {
    annot.drops = [];
    annot.sections = [];
    summary();
  });
  $('annotExport').addEventListener('click', () => {
    const trueBpm = Number(($('trueBpm') as HTMLInputElement).value) || undefined;
    const data = { name: song.file?.name ?? 'track', drops: annot.drops, sections: annot.sections, trueBpm };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `${(song.file?.name ?? 'track').replace(/\.[^.]+$/, '')}.annotation.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('annotScore').addEventListener('click', async () => {
    const decoded = await song.decodeMono().catch(() => null);
    if (!decoded) {
      annotOut.textContent = 'Load a song first (Play a song), then Score.';
      return;
    }
    const t0 = performance.now();
    const res = analyseSignal(decoded.mono, decoded.sr);
    const ms = Math.round(performance.now() - t0);
    const drops = matchEvents(
      annot.drops,
      Array.from(res.drops, (d) => d.time),
      beatTolerance(res.bpm),
    );
    const barTol = res.bpm > 0 ? (60 / res.bpm) * 4 : 2;
    const secs = matchEvents(
      annot.sections,
      Array.from(res.sections, (s) => s.start),
      barTol,
    );
    const trueBpm = Number(($('trueBpm') as HTMLInputElement).value);
    const tempo = trueBpm > 0 ? scoreTempo(res.bpm, trueBpm) : null;
    const pct = (x: number): string => `${Math.round(x * 100)}%`;
    const tempoNote = tempo ? (tempo.within4pct ? ' ✓' : tempo.octaveError ? ' (octave)' : ' ✗') : '';
    annotOut.textContent =
      `BPM ${res.bpm.toFixed(1)}${tempoNote} · ` +
      `drops ${drops.hits}/${drops.refCount} hit, ${drops.falsePositives} false ` +
      `(recall ${pct(drops.recall)}, prec ${pct(drops.precision)}) · ` +
      `sections recall ${pct(secs.recall)} · analysed in ${ms} ms`;
  });
  window.addEventListener('keydown', (e) => {
    if (!annot.on || inputTag(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'd') mark('drop');
    else if (k === 's') mark('section');
  });
}

buildCovers();
bind();
startReading(performance.now());
setInterval(() => {
  $('perf').textContent =
    `${frameMs.toFixed(1)} ms / frame · ${flashes.count(performance.now())} / 3 flashes this second`;
}, 300);
requestAnimationFrame(frame);
