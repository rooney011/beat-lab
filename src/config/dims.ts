export type DimId = 'inkfall' | 'riso' | 'pressline' | 'static';

export interface Dim {
  id: DimId;
  code: string;
  name: string;
  stage: string;
  accent: string;
  caption: string;
  /** Three ink plates: the halftone colours every layer prints with. */
  plates: [string, string, string];
  /** Swatch colours for the picker. */
  sw: [string, string, string];
  ray: string;
  /** Intensity needed to climb into this dimension. */
  th: number;
}

/** The four "dimensions": visual intensity levels the stage climbs through. */
export const DIMS: readonly Dim[] = [
  {
    id: 'inkfall',
    code: 'DIM-01',
    name: 'Inkfall',
    stage: '#0B0A10',
    accent: '#FF3B2F',
    caption: '#F3EEE3',
    plates: ['#F3EEE3', '#FF3B2F', '#5B5568'],
    sw: ['#F3EEE3', '#FF3B2F', '#5B5568'],
    ray: '#F3EEE3',
    th: 0,
  },
  {
    id: 'riso',
    code: 'DIM-02',
    name: 'Riso Heat',
    stage: '#17121A',
    accent: '#FF6FAE',
    caption: '#FFE23B',
    plates: ['#FF6FAE', '#4B6BFF', '#FFE23B'],
    sw: ['#FF6FAE', '#4B6BFF', '#FFE23B'],
    ray: '#FF6FAE',
    th: 0.32,
  },
  {
    id: 'pressline',
    code: 'DIM-03',
    name: 'Pressline',
    stage: '#0B0A10',
    accent: '#FF2E93',
    caption: '#FFE23B',
    plates: ['#FF2E93', '#2F6BFF', '#FFE23B'],
    sw: ['#FF2E93', '#2F6BFF', '#FFE23B'],
    ray: '#2F6BFF',
    th: 0.56,
  },
  {
    id: 'static',
    code: 'DIM-04',
    name: 'Static Bloom',
    stage: '#070A14',
    accent: '#3EE6FF',
    caption: '#F3EEE3',
    plates: ['#2F6BFF', '#F3EEE3', '#FF2E93'],
    sw: ['#2F6BFF', '#3EE6FF', '#FF2E93'],
    ray: '#2F6BFF',
    th: 0.8,
  },
];

export interface LayerBudget {
  /** Background opacity multiplier. */
  bg: number;
  word: number;
  towers: number;
  crew: number;
  rings: number;
  /** Stamps, splats and streaks. */
  fx: number;
  letters: number;
}

/** Which layers each dimension may draw. Each step adds layers instead of turning the same ones up. */
export const LAYERS: readonly LayerBudget[] = [
  { bg: 0.35, word: 0, towers: 0, crew: 0, rings: 0, fx: 0, letters: 0 },
  { bg: 1, word: 1, towers: 0, crew: 1, rings: 1, fx: 0, letters: 0 },
  { bg: 1, word: 1, towers: 1, crew: 1, rings: 1, fx: 1, letters: 1 },
  { bg: 1, word: 1, towers: 1, crew: 1, rings: 1, fx: 1, letters: 1 },
];

/** Dancers per dimension: [desktop, mobile]. */
export const CREW_COUNT: readonly [number, number][] = [
  [0, 0],
  [3, 2],
  [5, 3],
  [6, 3],
];

export type PanelMode = 'crop' | 'duo' | 'invert';
export interface Panel {
  poly: [number, number][];
  /** Bounding box [x, y, w, h] in 0..1 units. */
  bb: [number, number, number, number];
  z: number;
  ox: number;
  oy: number;
  mode: PanelMode;
}

function panel(poly: [number, number][], z: number, ox: number, oy: number, mode: PanelMode = 'crop'): Panel {
  let x0 = 1,
    y0 = 1,
    x1 = 0,
    y1 = 0;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { poly, bb: [x0, y0, x1 - x0, y1 - y0], z, ox, oy, mode };
}

/** Comic-panel layouts the stage can be re-cut into on strong beats. */
export const PANEL_LAYOUTS: readonly Panel[][] = [
  [
    panel(
      [
        [0, 0],
        [0.6, 0],
        [0.45, 1],
        [0, 1],
      ],
      1,
      -0.04,
      0,
    ),
    panel(
      [
        [0.6, 0],
        [1, 0],
        [1, 1],
        [0.45, 1],
      ],
      2.1,
      0.08,
      -0.05,
      'duo',
    ),
  ],
  [
    panel(
      [
        [0, 0],
        [1, 0],
        [1, 0.5],
        [0, 0.58],
      ],
      1.2,
      0,
      -0.02,
    ),
    panel(
      [
        [0, 0.58],
        [0.5, 0.54],
        [0.46, 1],
        [0, 1],
      ],
      2.4,
      -0.07,
      0.05,
    ),
    panel(
      [
        [0.5, 0.54],
        [1, 0.5],
        [1, 1],
        [0.46, 1],
      ],
      1.7,
      0.09,
      0.06,
    ),
  ],
  [
    panel(
      [
        [0, 0],
        [0.55, 0],
        [0.52, 0.48],
        [0, 0.5],
      ],
      1.6,
      -0.05,
      -0.05,
    ),
    panel(
      [
        [0.55, 0],
        [1, 0],
        [1, 0.46],
        [0.52, 0.48],
      ],
      2.6,
      0.1,
      -0.08,
      'duo',
    ),
    panel(
      [
        [0, 0.5],
        [0.52, 0.48],
        [0.5, 1],
        [0, 1],
      ],
      2.2,
      -0.1,
      0.07,
    ),
    panel(
      [
        [0.52, 0.48],
        [1, 0.46],
        [1, 1],
        [0.5, 1],
      ],
      1.2,
      0.03,
      0.03,
    ),
  ],
  [
    panel(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      1,
      0,
      0,
    ),
    panel(
      [
        [0.62, 0.08],
        [0.94, 0.06],
        [0.95, 0.42],
        [0.63, 0.44],
      ],
      2.8,
      0.06,
      -0.06,
      'invert',
    ),
  ],
  [
    panel(
      [
        [0, 0],
        [0.36, 0],
        [0.3, 1],
        [0, 1],
      ],
      2.2,
      -0.08,
      0,
    ),
    panel(
      [
        [0.36, 0],
        [0.7, 0],
        [0.64, 1],
        [0.3, 1],
      ],
      1.1,
      0,
      0,
    ),
    panel(
      [
        [0.7, 0],
        [1, 0],
        [1, 1],
        [0.64, 1],
      ],
      2.6,
      0.09,
      0.04,
      'duo',
    ),
  ],
];

export const INK = '#0B0A10';
export const PAPER = '#F3EEE3';
