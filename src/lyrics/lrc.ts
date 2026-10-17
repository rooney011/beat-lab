import { STEP_SECONDS } from '../audio/demo-synth';

export interface LyricWord {
  w: string;
  /** Word start in seconds, when the file gives one (enhanced LRC). */
  t: number | null;
}

export interface LyricLine {
  t: number;
  /** Line end: the next line's start, capped at 6.5 s. Set by `finishLines`. */
  end: number;
  text: string;
  words: LyricWord[];
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g;

const toSeconds = (min: string, sec: string): number => Number(min) * 60 + Number(sec.replace(':', '.'));

/**
 * Parse LRC text: one or more [mm:ss.xx] tags per line, an optional [offset:±ms] tag,
 * and optional enhanced-LRC word tags <mm:ss.xx>. Returns lines sorted by time.
 */
export function parseLRC(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  let offset = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const om = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (om) {
      offset = Number(om[1]) / 1000;
      continue;
    }
    const times: number[] = [];
    let last = 0;
    TIME_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(line)) !== null && m.index === last) {
      times.push(toSeconds(m[1], m[2]));
      last = TIME_TAG.lastIndex;
    }
    if (!times.length) continue;
    const body = line.slice(last).trim();
    const words: LyricWord[] = [];
    let timed = false;
    WORD_TAG.lastIndex = 0;
    let wm: RegExpExecArray | null;
    while ((wm = WORD_TAG.exec(body)) !== null) {
      timed = true;
      const tt = toSeconds(wm[1], wm[2]);
      wm[3]
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .forEach((w, j) => words.push({ w, t: j === 0 ? tt - offset : null }));
    }
    const plain = timed
      ? body
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : body;
    if (!timed) for (const w of plain.split(/\s+/).filter(Boolean)) words.push({ w, t: null });
    for (const tt of times) out.push({ t: tt - offset, end: 0, text: plain, words: words.map((x) => ({ ...x })) });
  }
  out.sort((a, b) => a.t - b.t);
  return finishLines(out);
}

/** Give every line an end time: the next line's start, capped at 6.5 s. */
export function finishLines(lines: LyricLine[]): LyricLine[] {
  for (let i = 0; i < lines.length; i++) {
    const next = i + 1 < lines.length ? lines[i + 1].t : lines[i].t + 5;
    lines[i].end = Math.min(next, lines[i].t + 6.5);
  }
  return lines;
}

/**
 * Word reveal times for a line. Known word times are kept; gaps are interpolated; lines with no
 * word timing are spread over 70% of the line, snapped to an eighth-note grid at the song's tempo.
 */
export function wordTimes(line: LyricLine, bpm: number): number[] {
  const n = line.words.length;
  const grid = 60 / (bpm || 120) / 2;
  const span = Math.min(Math.max(0.3, line.end - line.t) * 0.7, n * grid);
  const out: number[] = line.words.map((w) => w.t ?? NaN);
  const known = out.some((x) => !Number.isNaN(x));
  if (!known) {
    for (let i = 0; i < n; i++) out[i] = line.t + Math.round((span * i) / Math.max(1, n) / grid) * grid;
  } else {
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(out[i])) continue;
      let a = -1;
      let b = -1;
      for (let j = i - 1; j >= 0; j--)
        if (line.words[j].t !== null) {
          a = j;
          break;
        }
      for (let j = i + 1; j < n; j++)
        if (line.words[j].t !== null) {
          b = j;
          break;
        }
      if (a >= 0 && b >= 0) out[i] = out[a] + ((out[b] - out[a]) * (i - a)) / (b - a);
      else if (a >= 0) out[i] = out[a] + (i - a) * grid;
      else out[i] = line.t;
    }
  }
  for (let i = 1; i < n; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return out;
}

/** Original lyrics for the demo beat, timed to its bars. */
export function demoLyrics(): LyricLine[] {
  const spb = STEP_SECONDS;
  const L: [number, number, string][] = [
    [0, 0, 'Midnight on the press floor'],
    [4, 0, 'ink still wet on every street'],
    [8, 0, 'Count it in, one, two'],
    [10, 0, 'every block a panel'],
    [12, 0, 'every step a beat'],
    [14, 8, 'hold your breath'],
    [16, 0, 'THE CITY PRINTS IN COLOR'],
    [18, 0, 'misfire, misfire'],
    [20, 0, "we don't line up, we light up"],
    [22, 0, 'off the grid and out of frame'],
    [24, 0, 'LOUDER'],
    [25, 0, 'BRIGHTER'],
    [26, 0, 'OUT OF REGISTER!'],
    [28, 0, 'page turns, quiet now'],
    [30, 0, 'same city, next issue'],
  ];
  return finishLines(
    L.map(([bar, step, text]) => {
      const t = (bar * 16 + step) * spb;
      const gap = bar >= 24 && bar < 28 ? 4 : 2;
      return { t, end: 0, text, words: text.split(' ').map((w, i) => ({ w, t: t + i * gap * spb })) };
    }),
  );
}
