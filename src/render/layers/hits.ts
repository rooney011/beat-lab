import { INK, PAPER } from '../../config/dims';
import { slam } from '../../util/math';
import { pick, randomList } from '../../util/rand';
import type { DrawContext } from '../context';
import { FONT_DISPLAY } from '../fonts';

type StampType = 'star' | 'burst' | 'disc' | 'bolt' | 'block';

interface Stamp {
  type: StampType;
  x: number;
  y: number;
  s: number;
  rot: number;
  ci: number;
  solid: boolean;
  j: number[];
  t0: number;
}

interface Splat {
  x: number;
  y: number;
  s: number;
  r: number[];
  drops: [number, number, number][];
  rot: number;
  ci: number;
  t0: number;
}

interface Streak {
  y: number;
  dir: 1 | -1;
  dy: number[];
  l: number[];
  w: number[];
  t0: number;
}

interface Letter {
  w: string;
  x: number;
  y: number;
  rot: number;
  t0: number;
  j: number[];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  s: number;
  c: string;
}

const SOUND_WORDS = ['THOOM', 'KRAK', 'BLAM', 'ZZAP', 'WHUMP', 'SKRT', 'BOOM', 'FWOOSH', 'KA-CHUNK', 'BRAKKA'];
const STAMP_TYPES: readonly StampType[] = ['star', 'burst', 'disc', 'bolt', 'block'];

export interface StageBox {
  W: number;
  H: number;
  mob: boolean;
}

/** Short-lived hit graphics: impact stamps (beats), ink splats and speed streaks (snares), sound words (strong beats), sparks (hi-hats). */
export class Hits {
  private stamps: Stamp[] = [];
  private splats: Splat[] = [];
  private streaks: Streak[] = [];
  private letter: Letter | null = null;
  private sparks: Spark[] = [];
  lastLetter = -9999;
  /** Fire a one-off spray of sparks on the next frame (leaving the cover). */
  sparkBurstPending = false;

  spawnStamp(t: number, box: StageBox): void {
    const { W, H, mob } = box;
    const md = Math.min(W, H);
    const cx = W * (mob ? 0.5 : 0.56);
    const cy = H * (mob ? 0.36 : 0.44);
    let x: number;
    let y: number;
    let tries = 0;
    do {
      x = W * (0.08 + Math.random() * 0.84);
      y = H * (0.12 + Math.random() * 0.6);
      tries++;
    } while (Math.hypot(x - cx, y - cy) < md * 0.3 && tries < 10);
    if (this.stamps.length >= 5) this.stamps.shift();
    this.stamps.push({
      type: pick(STAMP_TYPES),
      x,
      y,
      s: md * (mob ? 0.08 : 0.05 + Math.random() * 0.05),
      rot: (Math.random() - 0.5) * 0.9,
      ci: Math.floor(Math.random() * 3),
      solid: Math.random() < 0.35,
      j: randomList(24),
      t0: t,
    });
  }

  spawnSplat(t: number, box: StageBox): void {
    const { W, H } = box;
    const md = Math.min(W, H);
    const n = Math.random() < 0.4 ? 2 : 1;
    for (let q = 0; q < n; q++) {
      if (this.splats.length >= 14) this.splats.shift();
      const drops: [number, number, number][] = [];
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 1.3 + Math.random() * 0.9;
        drops.push([Math.cos(a) * d, Math.sin(a) * d, 0.08 + Math.random() * 0.14]);
      }
      this.splats.push({
        x: W * (0.06 + Math.random() * 0.88),
        y: H * (0.1 + Math.random() * 0.7),
        s: md * (0.022 + Math.random() * 0.03),
        r: randomList(14).map((x) => 0.55 + x * 0.55),
        drops,
        rot: Math.random() * 6.28,
        ci: Math.floor(Math.random() * 3),
        t0: t,
      });
    }
  }

  spawnStreak(t: number, box: StageBox): void {
    const H = box.H;
    const n = 6 + Math.floor(Math.random() * 5);
    const dy: number[] = [];
    const l: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < n; i++) {
      dy.push((Math.random() - 0.5) * H * 0.18);
      l.push(Math.random());
      w.push(1.5 + Math.random() * 3);
    }
    if (this.streaks.length >= 3) this.streaks.shift();
    this.streaks.push({ y: H * (0.18 + Math.random() * 0.55), dir: Math.random() < 0.5 ? 1 : -1, dy, l, w, t0: t });
  }

  spawnLetter(t: number, box: StageBox): void {
    const { W, H, mob } = box;
    this.letter = {
      w: pick(SOUND_WORDS),
      x: W * (mob ? 0.5 : 0.3 + Math.random() * 0.45),
      y: H * (mob ? 0.16 : 0.16 + Math.random() * 0.16),
      rot: ((Math.random() * 16 - 8) * Math.PI) / 180,
      t0: t,
      j: randomList(12),
    };
    this.lastLetter = t;
  }

  /** Stamps, splats and streaks (they sit under the sparks and sound word). */
  drawImpacts(dc: DrawContext): void {
    this.drawSplats(dc);
    this.drawStamps(dc);
    this.drawStreaks(dc);
  }

  private stampPath(type: StampType, s: number, j: number[]): Path2D {
    const p = new Path2D();
    if (type === 'disc') {
      p.arc(0, 0, s * 0.85, 0, Math.PI * 2);
      return p;
    }
    if (type === 'block') {
      p.rect(-s, -s * 0.55, s * 2, s * 1.1);
      return p;
    }
    if (type === 'bolt') {
      const q = [
        [-0.2, -1],
        [0.38, -1],
        [0.06, -0.18],
        [0.5, -0.18],
        [-0.28, 1],
        [0, 0.12],
        [-0.42, 0.12],
      ];
      q.forEach(([x, y], i) => (i ? p.lineTo(x * s, y * s) : p.moveTo(x * s, y * s)));
      p.closePath();
      return p;
    }
    const n = type === 'star' ? 8 : 12;
    const ri = type === 'star' ? 0.42 : 0.62;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const r = (i % 2 === 0 ? 1 + (j[i % 24] - 0.5) * 0.3 : ri + (j[(i + 5) % 24] - 0.5) * 0.12) * s;
      if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    p.closePath();
    return p;
  }

  private drawStamps(dc: DrawContext): void {
    const { c, t, D, k, off, pat } = dc;
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const st = this.stamps[i];
      const age = t - st.t0;
      if (age > 520) {
        this.stamps.splice(i, 1);
        continue;
      }
      let s = 1;
      let a = 1;
      if (age < 100) s = 1.5 - 0.5 * slam(age / 100);
      else if (age > 340) {
        const q = (age - 340) / 180;
        s = 1 - 0.2 * q;
        a = 1 - q;
      }
      const p = this.stampPath(st.type, st.s, st.j);
      c.save();
      c.translate(st.x, st.y);
      c.rotate(st.rot);
      c.scale(s, s);
      c.globalAlpha = Math.max(0, a);
      c.save();
      c.translate(-off * 0.9, off * 0.7);
      c.fillStyle = D.plates[1];
      c.fill(p);
      c.restore();
      c.fillStyle = st.solid ? D.plates[st.ci] : pat.dots(D.plates[st.ci], 3 * k, 8 * k, 15);
      c.fill(p);
      c.lineWidth = (3 * k) / s;
      c.lineJoin = 'miter';
      c.strokeStyle = PAPER;
      c.stroke(p);
      c.restore();
    }
    c.globalAlpha = 1;
  }

  private drawSplats(dc: DrawContext): void {
    const { c, t, D } = dc;
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const sp = this.splats[i];
      const age = t - sp.t0;
      if (age > 700) {
        this.splats.splice(i, 1);
        continue;
      }
      const g = age < 80 ? 0.6 + 0.4 * (age / 80) : 1;
      const a = age > 420 ? 1 - (age - 420) / 280 : 1;
      const n = sp.r.length;
      const s = sp.s * g;
      const pts: [number, number][] = [];
      for (let m = 0; m < n; m++) {
        const an = sp.rot + (m / n) * Math.PI * 2;
        pts.push([sp.x + Math.cos(an) * s * sp.r[m], sp.y + Math.sin(an) * s * sp.r[m]]);
      }
      c.beginPath();
      c.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
      for (let m = 0; m < n; m++) {
        const nx = pts[(m + 1) % n];
        c.quadraticCurveTo(pts[m][0], pts[m][1], (pts[m][0] + nx[0]) / 2, (pts[m][1] + nx[1]) / 2);
      }
      c.closePath();
      for (const q of sp.drops) {
        const x = sp.x + q[0] * s;
        const y = sp.y + q[1] * s;
        c.moveTo(x + q[2] * s, y);
        c.arc(x, y, q[2] * s, 0, Math.PI * 2);
      }
      c.globalAlpha = Math.max(0, a);
      c.fillStyle = D.id === 'inkfall' ? (sp.ci === 1 ? '#FF3B2F' : PAPER) : D.plates[sp.ci];
      c.fill();
    }
    c.globalAlpha = 1;
  }

  private drawStreaks(dc: DrawContext): void {
    const { c, t, W, k } = dc;
    c.fillStyle = PAPER;
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const st = this.streaks[i];
      const p = (t - st.t0) / 260;
      if (p >= 1) {
        this.streaks.splice(i, 1);
        continue;
      }
      c.globalAlpha = 0.75 * (1 - p * 0.5);
      c.beginPath();
      for (let m = 0; m < st.dy.length; m++) {
        const len = W * (0.2 + 0.35 * st.l[m]);
        const travel = W + len * 2;
        const head = st.dir > 0 ? -len + p * travel : W + len - p * travel;
        const tail = head - st.dir * len;
        const y = st.y + st.dy[m];
        const hw = st.w[m] * k;
        c.moveTo(tail, y);
        c.lineTo(head, y - hw);
        c.lineTo(head, y + hw);
        c.closePath();
      }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  /** Hi-hat sparks: four-point stars thrown off the burst rim, additive. */
  drawSparks(dc: DrawContext, count: number): void {
    const { c, dt, cx, cy, R, D, k, calm, W, H } = dc;
    const cap = calm ? 12 : 120;
    let n = count;
    let fromCover = false;
    if (this.sparkBurstPending) {
      this.sparkBurstPending = false;
      n = calm ? 12 : 70;
      fromCover = true;
    }
    while (n-- > 0 && this.sparks.length < cap) {
      const a = Math.random() * Math.PI * 2;
      const v = (120 + 300 * Math.random()) * k;
      this.sparks.push({
        x: fromCover ? W * (0.08 + Math.random() * 0.3) : cx + Math.cos(a) * R * 1.1,
        y: fromCover ? H * (0.55 + Math.random() * 0.2) : cy + Math.sin(a) * R * 1.1,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 80 * k,
        life: 0.3 + 0.4 * Math.random(),
        age: 0,
        s: (3 + 4 * Math.random()) * k,
        c: Math.random() < 0.6 ? D.plates[2] : PAPER,
      });
    }
    if (!this.sparks.length) return;
    c.globalCompositeOperation = 'lighter';
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.age += dt;
      if (p.age > p.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vy += 600 * k * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const s = p.s;
      c.globalAlpha = 1 - p.age / p.life;
      c.fillStyle = p.c;
      c.beginPath();
      c.moveTo(p.x, p.y - s);
      c.lineTo(p.x + s * 0.28, p.y - s * 0.28);
      c.lineTo(p.x + s, p.y);
      c.lineTo(p.x + s * 0.28, p.y + s * 0.28);
      c.lineTo(p.x, p.y + s);
      c.lineTo(p.x - s * 0.28, p.y + s * 0.28);
      c.lineTo(p.x - s, p.y);
      c.lineTo(p.x - s * 0.28, p.y - s * 0.28);
      c.closePath();
      c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  /** Comic sound word in a jagged balloon: slams in, holds, fades (640 ms). */
  drawLetter(dc: DrawContext): void {
    const L = this.letter;
    if (!L) return;
    const { c, t, D, md, k } = dc;
    const age = t - L.t0;
    if (age > 640) {
      this.letter = null;
      return;
    }
    const sz = md * 0.11;
    let s = 1;
    let a = 1;
    if (age < 120) s = 1.45 - 0.45 * slam(age / 120);
    else if (age > 440) a = Math.max(0, 1 - (age - 440) / 200);
    c.save();
    c.globalAlpha = a;
    c.translate(L.x, L.y);
    c.rotate(L.rot);
    c.scale(s, s);
    c.font = `${Math.round(sz)}px ${FONT_DISPLAY}`;
    const tw = c.measureText(L.w).width;
    const rx = tw * 0.6 + sz * 0.5;
    const ry = sz * 0.95;
    const bal = new Path2D();
    for (let i = 0; i < 36; i++) {
      const an = (i / 36) * Math.PI * 2;
      const rr = i % 2 === 0 ? 1.12 + 0.14 * L.j[i % 12] : 0.86;
      const x = Math.cos(an) * rx * rr;
      const y = Math.sin(an) * ry * rr;
      if (i) bal.lineTo(x, y);
      else bal.moveTo(x, y);
    }
    bal.closePath();
    c.save();
    c.translate(-sz * 0.1, sz * 0.08);
    c.fillStyle = D.plates[1];
    c.fill(bal);
    c.restore();
    c.fillStyle = D.caption;
    c.fill(bal);
    c.lineWidth = 4 * k;
    c.lineJoin = 'miter';
    c.strokeStyle = INK;
    c.stroke(bal);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = D.plates[0] === PAPER ? '#FF3B2F' : D.plates[0];
    c.fillText(L.w, -sz * 0.06, sz * 0.05);
    c.fillStyle = INK;
    c.fillText(L.w, 0, 0);
    c.restore();
  }
}
