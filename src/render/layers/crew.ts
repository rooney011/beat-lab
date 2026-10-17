import type { Dim } from '../../config/dims';
import { INK } from '../../config/dims';
import type { Features, MoodId } from '../../types';
import { slam } from '../../util/math';
import { hash, seededRandom } from '../../util/rand';
import type { DrawContext } from '../context';
import { stringY } from './string';

type Pair = [number, number];
type DanceStyle = MoodId | 'calm' | 'none';

/** Joint angles (radians) for one frame of a dance. Arms/legs are [upper, lower]. */
interface Pose {
  lean: number;
  dip: number;
  jump: number;
  shift: number;
  nod: number;
  tilt: number;
  aL: Pair;
  aR: Pair;
  lL: Pair;
  lR: Pair;
}

interface Dancer {
  plate: number;
  scale: number;
  /** 0 none, 1 headphones, 2 spikes, 3 cap */
  acc: number;
  flip: 1 | -1;
  shade: boolean;
  t0: number;
  on: boolean;
  out: number;
}

export interface ClockInput {
  playing: boolean;
  live: boolean;
  /** Tempo from the mood reader's estimate, 0 if unknown. */
  clockBpm: number;
  /** Displayed BPM, 0 if hidden. */
  bpm: number;
}

/**
 * The ink crew: small procedural figures that dance on a beat clock.
 * The clock is a phase-locked loop: it free-runs at the estimated tempo and every detected beat
 * pulls the phase toward the nearest whole beat (45% inside ±¼ beat, 15% outside).
 */
export class Crew {
  /** Beat phase: integer part counts beats, fraction is the position inside the beat. */
  ph = 0;
  private bpEMA = 0;
  private jumpBeat = -1;
  private jumpReq = false;
  private lastClockBeat = 0;
  private roster: { key: string; list: Dancer[] } | null = null;
  private readonly waveS = new Float32Array(160);

  updateClock(dt: number, t: number, f: Features, input: ClockInput): void {
    const per = input.clockBpm ? 60 / input.clockBpm : input.bpm ? 60 / input.bpm : this.bpEMA || 0.5;
    if (!input.playing || !input.live) {
      this.ph += dt / 1.6;
      return;
    }
    const before = Math.floor(this.ph);
    this.ph += dt / per;
    if (f.beat) {
      const fr = this.ph - Math.floor(this.ph);
      const err = fr > 0.5 ? fr - 1 : fr;
      this.ph -= err * (Math.abs(err) < 0.25 ? 0.45 : 0.15);
      if (this.lastClockBeat) {
        const d = (t - this.lastClockBeat) / 1000;
        if (d > 0.28 && d < 1.0) this.bpEMA = this.bpEMA ? this.bpEMA * 0.85 + d * 0.15 : d;
      }
      this.lastClockBeat = t;
      if (f.strong) this.jumpReq = true;
    }
    if (Math.floor(this.ph) !== before && this.jumpReq) {
      this.jumpBeat = Math.floor(this.ph);
      this.jumpReq = false;
    }
  }

  private crewFor(key: string): Dancer[] {
    if (this.roster && this.roster.key === key) return this.roster.list;
    const r = seededRandom(hash(key + ':crew'));
    const list: Dancer[] = [];
    for (let i = 0; i < 6; i++) {
      list.push({
        plate: Math.floor(r() * 3),
        scale: 0.86 + r() * 0.26,
        acc: Math.floor(r() * 4),
        flip: r() < 0.5 ? -1 : 1,
        shade: r() < 0.5,
        t0: -1,
        on: false,
        out: 0,
      });
    }
    this.roster = { key, list };
    return list;
  }

  private pose(style: DanceStyle, fr: number, n: number, amp: number, t: number, altOff: number): Pose {
    const alt = (n + altOff) % 2 ? 1 : -1;
    const b = Math.pow(1 - fr, 3);
    const s2 = Math.sin(2 * Math.PI * fr);
    const p: Pose = {
      lean: 0,
      dip: 0,
      jump: 0,
      shift: 0,
      nod: 0,
      tilt: 0,
      aL: [-0.22, -0.12],
      aR: [0.22, 0.12],
      lL: [-0.12, -0.05],
      lR: [0.12, 0.05],
    };
    const lerp = (a: number, c: number, q: number): number => a + (c - a) * q;
    if (style === 'hype') {
      // Fist pumps on alternate arms; a star jump on the beat after a strong hit.
      const up = fr < 0.08 ? fr / 0.08 : Math.pow((1 - fr) / 0.92, 0.6);
      p.dip = b * 0.08 * amp;
      p.lean = alt * 0.08 * b * amp;
      p.tilt = alt * 0.15 * b * amp;
      const pump: Pair = [lerp(-0.3, -2.75, up * amp), lerp(-0.2, -2.95, up * amp)];
      const hold: Pair = [0.5, -1.9];
      if (alt < 0) {
        p.aL = pump;
        p.aR = hold;
      } else {
        p.aR = [-pump[0], -pump[1]];
        p.aL = [-hold[0], -hold[1]];
      }
      p.lL = [-0.12, 0.1];
      p.lR = [0.12, -0.1];
      if (this.jumpBeat === n && amp > 0.5) {
        const q = Math.sin(Math.PI * fr);
        p.jump = q * 0.18 * amp;
        p.lL = [-0.12 - 0.6 * q, 0.1 + 0.5 * q];
        p.lR = [0.12 + 0.6 * q, -0.1 - 0.5 * q];
        p.aL = [-2.4, -2.8];
        p.aR = [2.4, 2.8];
      }
    } else if (style === 'grit') {
      // Wide stance, head nods, alternating punches and stomps.
      p.dip = 0.05 + b * 0.06 * amp;
      p.nod = b * 0.45 * amp;
      p.lL = [-0.38 - b * 0.1, 0.16];
      p.lR = [0.38 + b * 0.1, -0.16];
      if (fr > 0.5) {
        const q = Math.sin(Math.PI * (fr - 0.5) * 2) * amp;
        if (alt < 0) p.lL = [-0.38 - 1.0 * q, 0.16 + 0.9 * q];
        else p.lR = [0.38 + 1.0 * q, -0.16 - 0.9 * q];
      }
      const punch: Pair = [0.4 + 1.1 * b * amp, 0.4 + 1.25 * b * amp];
      const guard: Pair = [-0.45, -2.4];
      if (alt > 0) {
        p.aR = punch;
        p.aL = guard;
      } else {
        p.aL = [-punch[0], -punch[1]];
        p.aR = [-guard[0], -guard[1]];
      }
    } else if (style === 'dreamy' || style === 'calm') {
      // A slow two-beat sway with floating arms.
      const psi = ((((n % 2) + 2) % 2) + fr) / 2;
      const sw = Math.sin(2 * Math.PI * psi) * amp;
      const k2 = style === 'calm' ? 0.5 : 1;
      p.lean = 0.12 * sw * k2;
      p.shift = 0.05 * sw * k2;
      p.tilt = 0.2 * sw * k2;
      const lu = -(0.7 + 1.5 * (0.5 + 0.5 * sw) * k2);
      const ru = 0.7 + 1.5 * (0.5 - 0.5 * sw) * k2;
      p.aL = [lu, lu - 0.6 * Math.sin(2 * Math.PI * psi + 1) * k2];
      p.aR = [ru, ru - 0.6 * Math.sin(2 * Math.PI * psi + 1 + Math.PI) * k2];
      if (style === 'calm') {
        p.aL = [-0.3 - 0.15 * sw, -0.2];
        p.aR = [0.3 - 0.15 * sw, 0.2];
      }
      p.lL = [-0.1 + 0.1 * sw, -0.04];
      p.lR = [0.1 + 0.1 * sw, 0.04];
    } else if (style === 'brooding') {
      // Hands in pockets, a heavy nod.
      p.nod = b * 0.35 * amp;
      p.dip = b * 0.04 * amp;
      p.lean = 0.04 + 0.06 * Math.sin(t * 0.0012) * amp;
      p.shift = 0.02 * Math.sin(t * 0.0012) * amp;
      p.aL = [-0.15, 0.5];
      p.aR = [0.2 + 0.06 * s2 * amp, 0.1 + 0.08 * s2 * amp];
      p.lL = [-0.15, -0.05];
      p.lR = [0.26, -0.18];
    } else {
      // No mood yet: an easy bounce.
      const q = (1 - Math.cos(2 * Math.PI * fr)) / 2;
      p.dip = q * 0.04 * amp;
      p.lean = 0.03 * Math.sin(t * 0.002);
      p.aL = [-0.2 - 0.12 * s2 * amp, -0.1];
      p.aR = [0.2 + 0.12 * s2 * amp, 0.1];
      p.lL = [-0.12, 0.1];
      p.lR = [0.12, -0.1];
    }
    if (!p.jump) {
      p.lL = [p.lL[0] - p.dip * 3, p.lL[1] + p.dip * 2];
      p.lR = [p.lR[0] + p.dip * 3, p.lR[1] - p.dip * 2];
    }
    return p;
  }

  draw(dc: DrawContext, opts: { songKey: string; count: number; mood: MoodId | null; playing: boolean }): void {
    const { c, t, W, H, k, D, off, mob, dose, calm, f } = dc;
    const list = this.crewFor(opts.songKey);
    const slots = mob ? [0.16, 0.84, 0.5] : [0.13, 0.87, 0.26, 0.75, 0.05, 0.95];
    const style: DanceStyle = calm ? 'calm' : (opts.mood ?? 'none');
    const amp = (opts.playing ? 1 : 0.35) * (0.6 + 0.4 * dose) * (0.85 + 0.3 * f.pulse);
    // Feet ride a smoothed copy of the string.
    const ws = this.waveS;
    const w = dc.a.wave;
    for (let i = 0; i < ws.length; i++) ws[i] += (w[i] - ws[i]) * 0.08;
    const y0 = H * stringY(mob);
    const hh = H * (mob ? 0.1 : 0.13);
    const n = Math.floor(this.ph);
    const fr = this.ph - n;
    for (let i = 0; i < 6; i++) {
      const d = list[i];
      const want = i < opts.count && i < slots.length;
      if (want && !d.on) {
        d.on = true;
        d.t0 = t;
        d.out = 0;
      }
      if (!want && d.on) {
        d.on = false;
        d.out = t;
      }
      let sc: number;
      if (d.on) sc = calm ? 1 : slam(Math.min(1, (t - d.t0) / 220));
      else {
        if (!d.out || t - d.out > 200) continue;
        sc = 1 - (t - d.out) / 200;
      }
      if (sc <= 0.01 || i >= slots.length) continue;
      const x = W * slots[i];
      const wi = Math.min(ws.length - 1, Math.max(0, Math.round((x / W) * (ws.length - 1))));
      const ground = y0 + ws[wi] * H * 0.04;
      const pose = this.pose(style, fr, n, amp, t, d.flip > 0 ? 0 : 1);
      this.figure(c, x, ground, hh * d.scale * sc, pose, d, D, k, off, dc);
    }
  }

  private figure(
    c: CanvasRenderingContext2D,
    x: number,
    ground: number,
    h: number,
    p: Pose,
    d: Dancer,
    D: Dim,
    k: number,
    off: number,
    dc: DrawContext,
  ): void {
    const hr = h * 0.13;
    const torso = h * 0.27;
    const ua = h * 0.16;
    const fa = h * 0.15;
    const th = h * 0.2;
    const sh = h * 0.2;
    const lw = Math.max(3 * k, h * 0.1);
    const ow = lw + 5 * k;
    const sgn = d.flip;
    const dir = (a: number): Pair => [Math.sin(a * sgn), Math.cos(a)];
    const lean = p.lean * sgn;
    const lL: Pair = sgn > 0 ? p.lL : [p.lR[0], p.lR[1]];
    const lR: Pair = sgn > 0 ? p.lR : [p.lL[0], p.lL[1]];
    const footRel = (l: Pair): number => th * Math.cos(l[0]) + sh * Math.cos(l[1]);
    const hipY = ground - Math.max(footRel(lL), footRel(lR)) - lw * 0.4 - p.jump * h;
    const hipX = x + p.shift * h * sgn;
    const up: Pair = [Math.sin(lean), -Math.cos(lean)];
    const side: Pair = [Math.cos(lean), Math.sin(lean)];
    const sh0: Pair = [hipX + up[0] * torso, hipY + up[1] * torso];
    const hw = h * 0.07;
    const sw = h * 0.1;
    const kneeL: Pair = [hipX - hw + dir(lL[0])[0] * th, hipY + dir(lL[0])[1] * th];
    const footL: Pair = [kneeL[0] + dir(lL[1])[0] * sh, kneeL[1] + dir(lL[1])[1] * sh];
    const kneeR: Pair = [hipX + hw + dir(lR[0])[0] * th, hipY + dir(lR[0])[1] * th];
    const footR: Pair = [kneeR[0] + dir(lR[1])[0] * sh, kneeR[1] + dir(lR[1])[1] * sh];
    const aLd = sgn > 0 ? p.aL : p.aR;
    const aRd = sgn > 0 ? p.aR : p.aL;
    const shL: Pair = [sh0[0] - side[0] * sw, sh0[1] - side[1] * sw];
    const shR: Pair = [sh0[0] + side[0] * sw, sh0[1] + side[1] * sw];
    const elL: Pair = [shL[0] + dir(aLd[0])[0] * ua, shL[1] + dir(aLd[0])[1] * ua];
    const hdL: Pair = [elL[0] + dir(aLd[1])[0] * fa, elL[1] + dir(aLd[1])[1] * fa];
    const elR: Pair = [shR[0] + dir(aRd[0])[0] * ua, shR[1] + dir(aRd[0])[1] * ua];
    const hdR: Pair = [elR[0] + dir(aRd[1])[0] * fa, elR[1] + dir(aRd[1])[1] * fa];
    const nod = p.nod * hr * 0.7;
    const head: Pair = [
      sh0[0] + up[0] * (hr * 1.25) + Math.sin(p.tilt * sgn) * hr * 0.4,
      sh0[1] + up[1] * (hr * 1.25) + nod,
    ];
    const limbs: Pair[][] = [
      [[hipX - hw, hipY], kneeL, footL],
      [[hipX + hw, hipY], kneeR, footR],
      [shL, elL, hdL],
      [shR, elR, hdR],
    ];
    const body = new Path2D();
    body.moveTo(hipX, hipY);
    body.lineTo(sh0[0], sh0[1]);
    body.moveTo(shL[0], shL[1]);
    body.lineTo(shR[0], shR[1]);
    body.moveTo(hipX - hw, hipY);
    body.lineTo(hipX + hw, hipY);
    const lp = new Path2D();
    for (const L of limbs) {
      lp.moveTo(L[0][0], L[0][1]);
      lp.lineTo(L[1][0], L[1][1]);
      lp.lineTo(L[2][0], L[2][1]);
    }
    const hp = new Path2D();
    hp.arc(head[0], head[1], hr, 0, Math.PI * 2);
    const col = D.plates[d.plate];
    const ghost = D.plates[(d.plate + 1) % 3];
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // Misregistered ghost plate, then ink outline, then colour.
    c.save();
    c.translate(off * 0.8, -off * 0.4);
    c.globalAlpha = 0.7;
    c.strokeStyle = ghost;
    c.lineWidth = lw * 1.5;
    c.stroke(body);
    c.lineWidth = lw;
    c.stroke(lp);
    c.fillStyle = ghost;
    c.fill(hp);
    c.restore();
    c.globalAlpha = 1;
    c.strokeStyle = INK;
    c.lineWidth = lw * 1.5 + 4 * k;
    c.stroke(body);
    c.lineWidth = ow;
    c.stroke(lp);
    c.lineWidth = 4 * k;
    c.stroke(hp);
    c.strokeStyle = col;
    c.lineWidth = lw * 1.5;
    c.stroke(body);
    c.lineWidth = lw;
    c.stroke(lp);
    c.fillStyle = col;
    c.fill(hp);
    if (d.shade) {
      c.globalAlpha = 0.35;
      c.strokeStyle = dc.pat.dots(INK, 1.1 * k, 4 * k, 45);
      c.lineWidth = lw * 1.5;
      c.stroke(body);
      c.lineWidth = lw;
      c.stroke(lp);
      c.globalAlpha = 1;
    }
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.fillStyle = INK;
    if (d.acc === 1) {
      c.beginPath();
      c.arc(head[0], head[1], hr * 1.18, Math.PI * 1.05, Math.PI * 1.95);
      c.stroke();
      c.fillRect(head[0] - hr * 1.32, head[1] - hr * 0.3, hr * 0.42, hr * 0.7);
      c.fillRect(head[0] + hr * 0.9, head[1] - hr * 0.3, hr * 0.42, hr * 0.7);
    } else if (d.acc === 2) {
      c.beginPath();
      for (let j = -1; j <= 1; j++) {
        const bx = head[0] + j * hr * 0.55;
        const by = head[1] - hr * 0.8;
        c.moveTo(bx - hr * 0.3, by + hr * 0.2);
        c.lineTo(bx + j * hr * 0.15, by - hr * 0.55);
        c.lineTo(bx + hr * 0.3, by + hr * 0.2);
      }
      c.fill();
    } else if (d.acc === 3) {
      c.beginPath();
      c.arc(head[0], head[1] - hr * 0.1, hr * 1.02, Math.PI, 0);
      c.closePath();
      c.fill();
      c.fillRect(head[0] + (sgn > 0 ? -hr * 0.1 : -hr), head[1] - hr * 0.2, hr * 1.1, hr * 0.22);
    }
  }
}
