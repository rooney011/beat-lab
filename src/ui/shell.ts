import type { App } from '../app';
import { LiveSource } from '../audio/sources';
import { DIMS } from '../config/dims';
import { MOODS } from '../config/moods';
import type { Analysis, AppState, FxFlags, MotionPref, Quality, SourceId } from '../types';
import { ListeningOrb } from './listening-orb';
import { renderCard } from './cards';
import { all, attr, byId, h, ICONS, text } from './dom';

const STATUS_WORDS: Record<AppState['status'], string> = {
  ready: 'Ready',
  listening: 'Listening',
  paused: 'Paused',
  'no-signal': 'No signal',
  blocked: 'Mic blocked',
};
const SOURCE_WORDS: Record<SourceId, string> = { file: 'File', mic: 'Mic', tab: 'Tab' };
const STATUS_CLASS: Partial<Record<AppState['status'], string>> = {
  listening: 'is-listening',
  'no-signal': 'is-nosignal',
  blocked: 'is-blocked',
};

const FX_ITEMS: [keyof FxFlags, string, string][] = [
  ['cuts', 'Panel cuts', 'Strong beats re-cut the stage into comic panels.'],
  ['plates', 'Plate misregistration', 'Beats knock the inks out of line.'],
  ['lyrics', 'Lyrics', 'Synced caption boxes from LRCLIB or your .lrc file.'],
  ['dancers', 'Ink crew', 'Small figures that dance to the beat and the mood.'],
  ['letters', 'Sound lettering', 'Comic sound words on the biggest hits.'],
  ['stamps', 'Impact stamps', 'Shapes, ink splats and streaks on hits.'],
  ['glitch', 'Slice glitch', 'Static Bloom only.'],
  ['grain', 'Grain', 'Paper texture over the stage.'],
];

const SEGS = {
  motion: [
    ['system', 'System'],
    ['on', 'On'],
    ['off', 'Off'],
  ],
  strict: [
    ['std', 'Standard'],
    ['strict', 'Strict'],
  ],
  quality: [
    ['auto', 'Auto'],
    ['high', 'High'],
    ['low', 'Low'],
  ],
} as const;

/** Binds the static markup in index.html to the app: events in, state out. */
export class Shell {
  private readonly root = byId('app');
  private readonly np = byId('np');
  private readonly hud = byId('hud');
  private readonly plates: HTMLButtonElement[] = [];
  private readonly fxSwitches = new Map<keyof FxFlags, HTMLButtonElement>();
  private readonly segButtons: { group: keyof typeof SEGS; value: string; el: HTMLButtonElement }[] = [];
  private readonly tabOk = LiveSource.tabSupported();
  private dragDepth = 0;
  /** Where focus was before a dialog or the drawer opened, so it can go back there. */
  private returnFocus: HTMLElement | null = null;
  private scrubbing = false;
  private libMounted = false;
  /** The lazily-loaded library/playback module (null until the library screen is first opened). */
  private lib: typeof import('../library/store') | null = null;
  private crossSec = 4;
  /** The chip-sized listening globe, shown in the "Reading mood" chip. */
  private readonly orb = new ListeningOrb(12);
  private orbShowing = false;
  /** The chip's text colour, read when the chips render (not every frame). */
  private orbColor = '#F3EEE3';

  constructor(private readonly app: App) {
    this.build();
    this.bind();
    app.store.subscribe((s, prev) => this.render(s, prev));
    app.onFrame = (a) => this.frame(a);
    this.render(app.state, null);
    setInterval(() => this.updateHud(), 200);
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    const platesEl = byId('plates');
    DIMS.forEach((d, i) => {
      const b = h(
        'button',
        { class: 'plate', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => this.app.pickDim(i) },
        h(
          'span',
          { class: 'sw', 'aria-hidden': 'true' },
          ...d.sw.map((c) => {
            const dot = h('i');
            dot.style.background = c;
            return dot;
          }),
        ),
        h('span', { class: 'plate__name' }, d.name),
      );
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const j = (i + (e.key === 'ArrowRight' ? 1 : 3)) % 4;
          this.app.pickDim(j);
          this.plates[j].focus();
        }
      });
      this.plates.push(b);
      platesEl.append(b);
    });

    const fxList = byId('fxList');
    for (const [key, name, hint] of FX_ITEMS) {
      const sw = h(
        'button',
        { class: 'switch', type: 'button', role: 'switch', 'aria-label': name, onclick: () => this.app.toggleFx(key) },
        h('span', { class: 'switch__t', 'aria-hidden': 'true' }),
      );
      this.fxSwitches.set(key, sw);
      fxList.append(
        h(
          'div',
          { class: 'srow' },
          h('span', {}, h('span', { class: 'sname' }, name), h('span', { class: 'shint' }, hint)),
          sw,
        ),
      );
    }

    for (const host of all<HTMLElement>(document, '[data-segs]')) {
      const group = host.dataset.segs as keyof typeof SEGS;
      for (const [value, label] of SEGS[group]) {
        const b = h(
          'button',
          { type: 'button', 'aria-pressed': 'false', onclick: () => this.pickSeg(group, value) },
          label,
        );
        this.segButtons.push({ group, value, el: b });
        host.append(b);
      }
    }
    if (!this.tabOk) byId('coverTab').classList.add('is-off');
  }

  private pickSeg(group: keyof typeof SEGS, value: string): void {
    if (group === 'motion') this.app.setMotion(value as MotionPref);
    else if (group === 'strict') this.app.set({ strict: value === 'strict' });
    else this.app.setQuality(value as Quality);
  }

  // ---------------------------------------------------------------- events

  private bind(): void {
    const app = this.app;
    const on = (id: string, fn: () => void): void => byId(id).addEventListener('click', fn);
    on('coverFile', () => app.openFilePicker());
    on('coverMic', () => app.pickSource('mic'));
    on('coverTab', () => app.pickSource('tab'));
    on('coverCalm', () => app.toggleCalm());
    on('btnHud', () => app.set({ hud: !app.state.hud }));
    on('btnSettings', () => app.set({ drawer: !app.state.drawer }));
    on('btnClean', () => app.set({ clean: true }));
    on('btnUnclean', () => app.set({ clean: false }));
    on('btnFull', () => app.fullscreen());
    on('coverLibrary', () => app.openLibrary());
    on('btnLibrary', () => app.openLibrary());
    on('btnPlay', () => app.togglePlay());
    on('btnPrev', () => this.lib?.previousTrack());
    on('btnNext', () => this.lib?.nextTrack());
    on('btnShuffle', () => this.lib?.toggleShuffle());
    on('btnRepeat', () => this.lib?.cycleRepeat());
    on('btnAuto', () => app.toggleAuto());
    on('btnCalm', () => app.toggleCalm());
    on('btnCrew', () => app.toggleFx('dancers'));
    on('btnLyrics', () => app.toggleFx('lyrics'));
    on('btnCloseDrawer', () => app.set({ drawer: false }));
    on('wake', () => app.resumeAudio());
    for (const b of all<HTMLButtonElement>(document, '.ftab'))
      b.addEventListener('click', () => app.pickSource(b.dataset.source as SourceId));
    for (const b of all<HTMLButtonElement>(document, '[data-sync]'))
      b.addEventListener('click', () => app.nudgeSync(Number(b.dataset.sync)));
    for (const b of all<HTMLButtonElement>(document, '[data-sync-auto]'))
      b.addEventListener('click', () => app.toggleSyncAuto());
    for (const b of all<HTMLButtonElement>(document, '[data-cross]'))
      b.addEventListener('click', () => this.lib?.setCrossfade(this.crossSec + Number(b.dataset.cross)));
    for (const b of all<HTMLButtonElement>(document, '[data-toggle]')) {
      const key = b.dataset.toggle as 'autoHide' | 'shortcuts' | 'lyricsOnline' | 'aiMood' | 'coverColours';
      b.addEventListener('click', () => app.set({ [key]: !app.state[key] }));
    }

    const dose = byId<HTMLInputElement>('dose');
    dose.addEventListener('input', () => app.setDose(Number(dose.value)));
    const scrub = byId<HTMLInputElement>('scrub');
    scrub.addEventListener('pointerdown', () => (this.scrubbing = true));
    window.addEventListener('pointerup', () => (this.scrubbing = false));
    scrub.addEventListener('input', () => app.seek(Number(scrub.value)));

    const fileInput = byId<HTMLInputElement>('file');
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) app.takeFiles(fileInput.files);
      fileInput.value = '';
    });

    byId('scrim').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) app.set({ card: null });
    });

    for (const ev of ['pointermove', 'pointerdown', 'wheel'] as const)
      window.addEventListener(ev, () => app.poke(), { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && app.state.card) this.trapFocus(e);
      app.onKey(e);
    });
    const root = this.root;
    root.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.dragDepth++;
      app.set({ dragging: true });
    });
    root.addEventListener('dragleave', () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) app.set({ dragging: false });
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragDepth = 0;
      app.set({ dragging: false });
      if (e.dataTransfer?.files.length) app.takeFiles(e.dataTransfer.files);
    });
  }

  // ---------------------------------------------------------------- render

  private render(s: AppState, prev: AppState | null): void {
    const root = this.root;
    const D = DIMS[s.dim];
    const cover = s.screen === 'cover';
    root.dataset.layout = s.layout;
    root.classList.toggle('is-cover', cover);
    root.classList.toggle('is-idle', s.idle && !cover);
    root.classList.toggle('is-clean', s.clean && !cover);
    root.classList.toggle('is-calm', s.reduce);
    root.classList.toggle('is-drag', s.dragging);

    // Library (full-screen overlay; the Preact app mounts lazily on first open)
    const library = s.screen === 'library';
    root.classList.toggle('is-library', library);
    byId('library-root').hidden = !library;
    if (library && !this.libMounted) void this.ensureLibrary();

    // Cover
    const coverEl = byId('cover');
    coverEl.hidden = !cover;
    coverEl.classList.toggle('is-leaving', s.leaving);
    attr(byId('coverCalm'), 'aria-checked', String(s.reduce));

    // Status bar and masthead
    const M = s.mood ? MOODS[s.mood] : null;
    text(
      byId('slug'),
      `${D.code} ${D.name.toUpperCase()}${s.auto ? ' · AUTO' : ' · LOCKED'}${M ? ` · ${M.label}${s.bpm ? ` · ${s.bpm} BPM` : ''}` : s.source ? ' · READING MOOD' : ''}${s.queued >= 0 ? ` · NEXT ${DIMS[s.queued].name.toUpperCase()}` : ''}`,
    );
    byId('status').className = 'status ' + (STATUS_CLASS[s.status] ?? '');
    text(byId('srcWord'), s.source ? SOURCE_WORDS[s.source] : 'No source');
    text(byId('statusWord'), STATUS_WORDS[s.status]);
    text(byId('live'), `${STATUS_WORDS[s.status]}. ${D.name}.`);
    attr(byId('btnHud'), 'aria-pressed', String(s.hud));
    this.hud.hidden = !s.hud || cover;
    byId('btnUnclean').hidden = !(s.clean && !cover);

    // Source tabs
    for (const b of all<HTMLButtonElement>(document, '.ftab')) {
      const id = b.dataset.source as SourceId;
      const isOn = s.source === id;
      b.classList.toggle('is-on', isOn);
      b.classList.toggle('is-wait', s.requesting === id);
      b.classList.toggle('is-denied', id === 'mic' && s.micDenied && !isOn);
      // Tab capture needs desktop Chrome/Edge; show the tab everywhere but mark it unavailable.
      b.classList.toggle('is-off', id === 'tab' && !this.tabOk);
      attr(b, 'aria-pressed', String(isOn));
      const label = b.querySelector('span');
      if (label) text(label, s.requesting === id ? 'Waiting…' : id === 'file' ? 'File' : id === 'mic' ? 'Mic' : 'Tab');
    }

    // Now playing
    const meta = s.meta;
    text(
      byId('npKick'),
      s.source === 'file' ? `Now printing · ${meta.fmt || 'file'}` : s.source ? 'Live input' : 'No source yet',
    );
    const title = byId('npTitle');
    text(title, s.title || 'No track yet');
    title.title = s.title;
    text(byId('npArtist'), meta.artist || (s.source ? 'Unknown artist' : 'Pick a source on the tabs above'));
    text(
      byId('npAlbum'),
      meta.album || meta.year
        ? [meta.album, meta.year].filter(Boolean).join(' · ')
        : s.source === 'file'
          ? 'No album tag'
          : ' ',
    );
    attr(byId('art'), 'aria-label', `${s.hasArt ? 'Cover art for' : 'Generated cover for'} ${s.title || 'BEAT LAB'}`);
    if (
      !prev ||
      prev.mood !== s.mood ||
      prev.aiActive !== s.aiActive ||
      prev.bpm !== s.bpm ||
      prev.lyricSrc !== s.lyricSrc ||
      prev.meta !== s.meta ||
      prev.source !== s.source
    )
      this.renderChips(s);
    const btnPlay = byId('btnPlay');
    attr(btnPlay, 'aria-label', s.playing ? 'Pause' : 'Play');
    attr(byId('playIcon'), 'd', s.playing ? ICONS.pause : ICONS.play);
    text(byId('timeL'), s.timeL || '—');
    text(byId('timeR'), s.timeR);
    const isFile = s.source === 'file';
    byId('scrubWrap').hidden = !isFile;
    byId('npFill').hidden = isFile;
    if (isFile) {
      const scrub = byId<HTMLInputElement>('scrub');
      scrub.max = String(s.scrubMax);
      if (!this.scrubbing) scrub.value = String(s.scrub);
      attr(scrub, 'aria-valuetext', `${s.timeL} of ${s.scrubMax} seconds`);
      byId('scrubFill').style.width = Math.round((s.scrub / Math.max(1, s.scrubMax)) * 100) + '%';
    }
    this.updateMediaSession(s, prev);

    // Dimensions box
    this.plates.forEach((b, i) => {
      const isOn = i === s.dim;
      b.classList.toggle('is-on', isOn);
      b.classList.toggle('is-queued', i === s.queued);
      attr(b, 'aria-checked', String(isOn));
      b.tabIndex = isOn ? 0 : -1;
    });
    attr(byId('btnAuto'), 'aria-checked', String(s.auto));
    text(byId('autoLabel'), s.auto ? 'Auto' : 'Locked');
    attr(byId('btnCalm'), 'aria-checked', String(s.reduce));
    attr(byId('btnCrew'), 'aria-checked', String(s.fx.dancers));
    attr(byId('btnLyrics'), 'aria-checked', String(s.fx.lyrics));
    const dose = byId<HTMLInputElement>('dose');
    if (document.activeElement !== dose) dose.value = String(s.dose);
    byId('doseFill').style.width = s.dose + '%';
    text(byId('doseVal'), s.dose === 0 ? '0 · CALM' : String(s.dose));
    attr(dose, 'aria-valuetext', s.dose === 0 ? '0 percent, calm' : `${s.dose} percent`);
    const delay = this.app.syncDelay();
    const auto = s.syncMs === null;
    for (const el of all(document, '[data-sync-val]'))
      text(el, `${auto && el.closest('.drawer') ? 'Auto ' : ''}${delay} ms`);
    for (const b of all<HTMLButtonElement>(document, '[data-sync-auto]')) {
      if (b.classList.contains('switch')) attr(b, 'aria-checked', String(auto));
      else {
        b.classList.toggle('is-on', auto);
        attr(b, 'aria-pressed', String(auto));
      }
    }

    // Drawer
    const drawer = byId('drawer');
    const wasOpen = !drawer.hidden;
    drawer.hidden = !s.drawer;
    if (s.drawer && !wasOpen) {
      this.rememberFocus();
      byId('drawerTitle').focus();
    } else if (!s.drawer && wasOpen) this.restoreFocus();
    for (const [key, sw] of this.fxSwitches) attr(sw, 'aria-checked', String(s.fx[key]));
    for (const { group, value, el } of this.segButtons) {
      const cur = group === 'motion' ? s.motion : group === 'strict' ? (s.strict ? 'strict' : 'std') : s.quality;
      attr(el, 'aria-pressed', String(cur === value));
    }
    for (const b of all<HTMLButtonElement>(document, '[data-toggle]'))
      attr(
        b,
        'aria-checked',
        String(s[b.dataset.toggle as 'autoHide' | 'shortcuts' | 'lyricsOnline' | 'aiMood' | 'coverColours']),
      );
    const budget = s.strict ? 1 : 3;
    all(byId('flashMeter'), 'i').forEach(
      (cell, i) => (cell.className = i < budget ? (i < s.flashes ? 'is-on' : '') : 'is-na'),
    );
    text(byId('flashText'), `${s.flashes} / ${budget}`);
    text(byId('clampText'), `Safety clamps so far: ${s.clamps}`);
    text(byId('scaleText'), `Render scale ${s.scale.toFixed(2)}×`);

    // Dialog
    const scrim = byId('scrim');
    if (s.card && (!prev || prev.card !== s.card)) {
      if (scrim.hidden) this.rememberFocus();
      renderCard(this.app, s.card, {
        card: byId('card'),
        kick: byId('cardKick'),
        title: byId('cardTitle'),
        body: byId('cardBody'),
        actions: byId('cardActions'),
      });
      scrim.hidden = false;
      requestAnimationFrame(() => byId('cardActions').querySelector('button')?.focus());
    } else if (!s.card && !scrim.hidden) {
      scrim.hidden = true;
      this.restoreFocus();
    }

    // Overlays
    byId('wake').hidden = !s.suspended;
    const toast = byId('toast');
    toast.hidden = !s.toast;
    if (s.toast && s.toast !== prev?.toast) {
      toast.classList.toggle('toast--warn', s.toast.tone === 'warn');
      text(byId('toastKick'), s.toast.tone === 'warn' ? 'WARN' : 'INFO');
      text(byId('toastMsg'), s.toast.msg);
    }
  }

  private rememberFocus(): void {
    const el = document.activeElement;
    this.returnFocus = el instanceof HTMLElement && el !== document.body ? el : null;
  }

  private restoreFocus(): void {
    const el = this.returnFocus;
    this.returnFocus = null;
    if (el && el.isConnected && !el.closest('[hidden]')) el.focus();
  }

  /** Keep Tab inside the open dialog. */
  private trapFocus(e: KeyboardEvent): void {
    const items = all<HTMLElement>(byId('card'), 'button, [href], input, [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !byId('card').contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Code-split the library screen: its Preact + music-metadata chunk loads only on first open. */
  private async ensureLibrary(): Promise<void> {
    if (this.libMounted) return;
    this.libMounted = true;
    try {
      const app = this.app;
      const lib = await import('../library/store');
      this.lib = lib;
      lib.setBridge({ close: () => app.set({ screen: app.state.source ? 'live' : 'cover' }) });
      lib.setTransport({
        play: (file, deck, crossfadeSec, startSec, meta) => app.playTrackFile(file, deck, crossfadeSec, startSec, meta),
        seek: (s) => app.seek(s),
        position: () => app.playbackTime(),
        duration: () => app.playbackDuration(),
        setGain: (db) => app.setPlaybackGain(db),
      });
      app.queueHooks = { ended: () => lib.onQueueEnded(), external: () => lib.onExternalPlay() };
      lib.subscribePlayback(() => this.renderTransport());
      const { mountLibrary } = await import('../library/mount');
      mountLibrary(byId('library-root'));
      this.renderTransport();
    } catch (err) {
      this.libMounted = false;
      console.error(err);
    }
  }

  // ---------------------------------------------------------------- media session (lock screen / media keys)

  private mediaWired = false;

  /** Register the OS transport handlers once; they route to the same actions the on-screen controls use. */
  private wireMediaSession(): void {
    if (this.mediaWired || !('mediaSession' in navigator)) return;
    this.mediaWired = true;
    const app = this.app;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported in this browser */
      }
    };
    set('play', () => {
      if (!app.state.playing) app.togglePlay();
    });
    set('pause', () => {
      if (app.state.playing) app.togglePlay();
    });
    set('previoustrack', () => this.lib?.previousTrack());
    set('nexttrack', () => this.lib?.nextTrack());
    set('seekbackward', (d) => app.seekBy(-(d.seekOffset ?? 10)));
    set('seekforward', (d) => app.seekBy(d.seekOffset ?? 10));
    set('seekto', (d) => {
      if (typeof d.seekTime === 'number') app.seek(d.seekTime);
    });
    set('stop', () => {
      if (app.state.playing) app.togglePlay();
    });
  }

  /** Mirror the current track onto the OS media UI: metadata, play/pause state and the scrubber. */
  private updateMediaSession(s: AppState, prev: AppState | null): void {
    if (!('mediaSession' in navigator)) return;
    this.wireMediaSession();
    const ms = navigator.mediaSession;

    // Metadata: refresh when the track, its tags or its cover change.
    if (
      !prev ||
      prev.title !== s.title ||
      prev.meta !== s.meta ||
      prev.source !== s.source ||
      prev.hasArt !== s.hasArt
    ) {
      ms.metadata = s.source
        ? new MediaMetadata({
            title: s.title || 'BEAT LAB',
            artist: s.meta.artist || (s.source === 'file' ? 'Unknown artist' : 'Live input'),
            album: s.meta.album || '',
            artwork: this.coverArtwork(),
          })
        : null;
    }

    if (!prev || prev.playing !== s.playing || prev.source !== s.source)
      ms.playbackState = !s.source ? 'none' : s.playing ? 'playing' : 'paused';

    // The scrubber only applies to files; live input has no seekable position.
    if (!prev || prev.scrub !== s.scrub || prev.scrubMax !== s.scrubMax || prev.source !== s.source) {
      try {
        if (s.source === 'file' && s.scrubMax > 0)
          ms.setPositionState({ duration: s.scrubMax, position: Math.min(s.scrub, s.scrubMax), playbackRate: 1 });
        else ms.setPositionState();
      } catch {
        /* duration not ready yet — try again on the next change */
      }
    }
  }

  /** The now-playing cover canvas as a PNG for the OS media UI (works for generated and real art). */
  private coverArtwork(): MediaImage[] {
    try {
      const cv = byId<HTMLCanvasElement>('art');
      if (cv.width > 0 && cv.height > 0)
        return [{ src: cv.toDataURL('image/png'), sizes: `${cv.width}x${cv.height}`, type: 'image/png' }];
    } catch {
      /* tainted or unsupported — skip artwork */
    }
    return [];
  }

  /** Reflect queue shuffle/repeat/crossfade state onto the transport controls. */
  private renderTransport(): void {
    const lib = this.lib;
    if (!lib) return;
    const q = lib.queue.value;
    this.crossSec = lib.crossfadeSec.value;
    attr(byId('btnShuffle'), 'aria-pressed', String(q.shuffle));
    const repeat = byId('btnRepeat');
    attr(repeat, 'aria-pressed', String(q.repeat !== 'off'));
    attr(repeat, 'data-mode', q.repeat);
    for (const el of all(document, '[data-cross-val]')) text(el, `${this.crossSec}s`);
  }

  private renderChips(s: AppState): void {
    // The listening globe shows only while the mood is being read (a source, but no mood yet).
    const reading = !!s.source && !s.mood;
    const chips: [string, string][] = [
      [s.mood ? MOODS[s.mood].label : s.source ? 'Reading mood' : 'No mood yet', s.mood ? 'is-mood' : ''],
    ];
    if (s.mood && s.source) chips.push([`Mood · ${s.aiActive ? 'AI' : 'quick read'}`, s.aiActive ? 'is-ai' : '']);
    if (s.bpm) chips.push([`${s.bpm} BPM`, '']);
    if (s.source === 'file')
      chips.push([s.lyricSrc ? `Lyrics · ${s.lyricSrc}` : 'No lyrics', s.lyricSrc ? 'is-ink' : '']);
    if (s.meta.mb) chips.push([`${s.meta.fmt} · ${s.meta.mb} MB`, '']);
    const els = chips.map(([label, cls]) => h('span', { class: 'chip-s ' + cls }, label));
    byId('npChips').replaceChildren(...els);
    this.orbShowing = reading;
    if (reading) {
      els[0].prepend(this.orb.el);
      this.orbColor = getComputedStyle(els[0]).color || this.orbColor;
    }
  }

  /** Per-frame: the cover art bumps on the kick and the mini meter follows the spectrum. */
  private frame(a: Analysis): void {
    const st = this.np.style;
    st.setProperty('--kick', this.app.state.reduce ? '0' : Math.min(1, a.f.pulse).toFixed(3));
    for (let i = 0; i < 5; i++) {
      let v = 0;
      for (let b = i * 9; b < i * 9 + 9; b++) v += a.bars[b];
      st.setProperty('--lv' + i, Math.min(1, (v / 9) * 1.5).toFixed(3));
    }
    // Drive the chip globe off this same callback — no second animation loop.
    if (this.orbShowing) {
      const s = this.app.state;
      this.orb.draw(performance.now(), s.playing ? a.bars : null, this.orbColor, s.reduce);
    }
  }

  private updateHud(): void {
    const app = this.app;
    const s = app.state;
    if (!s.hud) return;
    const set = (k: string, v: string): void => {
      const el = this.hud.querySelector<HTMLElement>(`[data-hud="${k}"]`);
      if (el) text(el, v);
    };
    const now = app.director.now;
    const P = app.mood.profile;
    set('I', app.stats.intensity.toFixed(2));
    set('N', now >= 3 ? 'top' : DIMS[now + 1].th.toFixed(2));
    set('B', String(app.stats.beats));
    set('S', String(app.stats.strong));
    set('R', String(app.stats.snares));
    set('F', app.frameMs.toFixed(1) + ' ms');
    set('Q', s.scale.toFixed(2));
    set('L', `${s.flashes} / ${s.strict ? 1 : 3}`);
    set('M', s.mood ? MOODS[s.mood].label : s.source ? 'reading' : '—');
    set('T', s.bpm ? `${s.bpm} BPM` : P?.clockBpm ? `~${P.clockBpm} BPM (clock)` : '—');
    set('A', P?.decided ? `${P.A.toFixed(2)} · punch ${P.punchV.toFixed(2)}` : '—');
    set('V', P?.decided ? `${P.V.toFixed(2)} (${P.tiltDb.toFixed(0)} dB)` : '—');
    const ai = app.aiRead;
    set('aiA', ai ? ai.arousal.toFixed(2) : '—');
    set('aiV', ai ? ai.valence.toFixed(2) : '—');
    set('aiT', ai ? `${Math.round(ai.inferenceMs)} ms` : '—');
    set('Y', s.lyricSrc || 'none');
    set('D', `${app.syncDelay()} ms${s.syncMs === null ? ' (auto)' : ''}`);
    set('O', app.audio.ctx ? `${Math.round(app.audio.latencyMs())} ms` : '—');
  }
}
