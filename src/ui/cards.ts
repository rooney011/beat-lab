import type { App } from '../app';
import type { CardId } from '../types';
import { h } from './dom';

interface CardAction {
  label: string;
  primary?: boolean;
  run: (app: App) => void;
}

interface CardDef {
  kick: string;
  title: string;
  body: string[];
  fine?: string;
  error?: boolean;
  actions: CardAction[];
}

const openFile = (label: string, primary = false): CardAction => ({
  label,
  primary,
  run: (app) => {
    app.set({ card: null });
    app.openFilePicker();
  },
});
const useMic: CardAction = { label: 'Use mic', primary: true, run: (app) => app.pickSource('mic') };

export const CARDS: Record<CardId, CardDef> = {
  'perm-mic': {
    kick: 'Permission · Mic',
    title: 'Let it hear the room',
    body: ['Beat Lab listens through your mic and reacts to whatever is playing near you.'],
    fine: 'Audio is analysed on this device and never recorded.',
    actions: [
      { label: 'Allow mic', primary: true, run: (app) => void app.startLive('mic') },
      openFile('Open a file'),
    ],
  },
  'perm-tab': {
    kick: 'Permission · Tab',
    title: 'Pick a tab with music',
    body: ['Choose the tab that is playing and keep “Share tab audio” switched on.'],
    fine: 'Audio is analysed on this device and never recorded.',
    actions: [
      { label: 'Choose tab', primary: true, run: (app) => void app.startLive('tab') },
      openFile('Open a file'),
    ],
  },
  'err-mic-denied': {
    kick: 'Error · mic-denied',
    title: 'Mic is blocked',
    body: [
      'Your browser is blocking the mic for this site. Open the site settings next to the address bar, allow Microphone, then retry.',
    ],
    error: true,
    actions: [{ label: 'Retry', primary: true, run: (app) => void app.startLive('mic') }, openFile('Open a file')],
  },
  'err-mic-missing': {
    kick: 'Error · no-mic',
    title: 'No microphone found',
    body: ['Plug in or enable a microphone, then retry. Or play a file instead.'],
    error: true,
    actions: [{ label: 'Retry', primary: true, run: (app) => void app.startLive('mic') }, openFile('Open a file')],
  },
  'err-tab-noaudio': {
    kick: 'Error · tab-no-audio',
    title: 'No sound in that share',
    body: ['Pick a tab and keep “Share tab audio” switched on. Whole windows and screens often have no audio.'],
    error: true,
    actions: [{ label: 'Pick again', primary: true, run: (app) => void app.startLive('tab') }, openFile('Open a file')],
  },
  'err-tab-unsupported': {
    kick: 'Error · tab-unsupported',
    title: "Can't capture a tab here",
    body: [
      "Phone browsers don't let a website capture another tab's audio. Only Chrome or Edge on a computer can.",
      'Use your mic to react to sound around you, or open a file instead.',
    ],
    error: true,
    actions: [useMic, openFile('Open a file')],
  },
  'err-file': {
    kick: 'Error · file-unsupported',
    title: "Can't play this file",
    body: ['Try MP3, M4A, WAV, OGG or FLAC.'],
    error: true,
    actions: [openFile('Choose another', true)],
  },
  keys: {
    kick: 'Keyboard',
    title: 'Shortcuts',
    body: [],
    actions: [{ label: 'Close', primary: true, run: (app) => app.set({ card: null }) }],
  },
};

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['1 – 4', 'Pick a dimension (turns Auto off)'],
  ['A', 'Auto dimensions on / off'],
  ['[  ]', 'FX Dose −10 / +10'],
  [',  .', 'Visual sync delay −20 / +20 ms'],
  ['← →', 'Seek 5 s (files)'],
  ['L / C', 'Lyrics / ink crew on or off'],
  ['O M T', 'Open file, mic, tab'],
  ['H', 'Clean stage'],
  ['F', 'Fullscreen'],
  ['S', 'Settings'],
  ['Esc', 'Close dialog or drawer'],
];

/** Fill the shared dialog with one card's content. */
export function renderCard(
  app: App,
  id: CardId,
  parts: { kick: HTMLElement; title: HTMLElement; body: HTMLElement; actions: HTMLElement; card: HTMLElement },
): void {
  const def = CARDS[id];
  parts.card.classList.toggle('card--err', !!def.error);
  parts.card.setAttribute('role', def.error ? 'alertdialog' : 'dialog');
  parts.kick.textContent = def.kick;
  parts.title.textContent = def.title;
  parts.body.replaceChildren(
    ...def.body.map((p) => h('p', {}, p)),
    ...(def.fine ? [h('p', { class: 'fine' }, def.fine)] : []),
    ...(id === 'keys'
      ? [h('dl', { class: 'keys' }, ...SHORTCUTS.flatMap(([k, v]) => [h('dt', { class: 'mono' }, k), h('dd', {}, v)]))]
      : []),
  );
  parts.actions.replaceChildren(
    ...def.actions.map((a) =>
      h(
        'button',
        { class: 'btn' + (a.primary ? ' btn--primary' : ''), type: 'button', onclick: () => a.run(app) },
        a.label,
      ),
    ),
  );
}
