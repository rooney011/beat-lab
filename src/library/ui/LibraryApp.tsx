import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatTime } from '../../util/math';
import { getCover } from '../db';
import type { Track } from '../types';
import {
  albumKey,
  cancelScan,
  closeLibrary,
  folderPickerSupported,
  folders,
  importFiles,
  initLibrary,
  linkFolder,
  playTrack,
  query,
  queue,
  reconnectFolder,
  removeTrack,
  results,
  scan,
  shufflePlay,
  splitAlbumKey,
  storage,
  tracks,
  trackAlbumKey,
  view,
  type LibraryView,
} from '../store';

const VIEWS: [LibraryView, string][] = [
  ['albums', 'Albums'],
  ['artists', 'Artists'],
  ['songs', 'Songs'],
  ['queue', 'Queue'],
  ['search', 'Search'],
];

type SongSort = 'added' | 'played' | 'title' | 'artist';

// ---------------------------------------------------------------- cover art

const urlCache = new Map<string, string>();

function CoverImg({ track, size }: { track: Track; size: number }): JSX.Element {
  const [url, setUrl] = useState<string | null>(track.coverId ? (urlCache.get(track.coverId) ?? null) : null);
  useEffect(() => {
    const id = track.coverId;
    if (!id || urlCache.has(id)) return;
    let alive = true;
    void getCover(id).then((c) => {
      if (!alive || !c) return;
      const u = URL.createObjectURL(c.thumb);
      urlCache.set(id, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [track.coverId]);
  // No art: print a generated comic cover instead — a seeded colour plate, big initial and issue number.
  const seed = coverSeed(track);
  const initial = (track.album || track.title || '?').slice(0, 1).toUpperCase();
  return (
    <span class="lib-cover" style={{ width: `${size}px`, height: `${size}px` }}>
      {url ? (
        <img class="lib-cover__img" src={url} alt="" width={size} height={size} />
      ) : (
        <span class={`lib-cover__ph lib-cover__ph--v${seed % 4}`} aria-hidden="true">
          <span class="lib-cover__initial" style={{ fontSize: `${Math.round(size * 0.5)}px` }}>
            {initial}
          </span>
          {size >= 80 && <span class="lib-cover__issue mono">#{String((seed % 99) + 1).padStart(2, '0')}</span>}
        </span>
      )}
    </span>
  );
}

/** A stable non-negative seed from a track's album/artist, so its generated cover never changes. */
function coverSeed(track: Track): number {
  const s = `${track.album || track.title || ''}${track.albumArtist || track.artist || ''}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------------------------------------------------------------- rows and grids

function SongRow({ track, context }: { track: Track; context: string[] }): JSX.Element {
  return (
    <div
      class="lib-row"
      role="row"
      tabIndex={0}
      onClick={() => void playTrack(track, context)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void playTrack(track, context);
        }
      }}
    >
      <CoverImg track={track} size={40} />
      <span class="lib-row__main">
        <span class="lib-row__title">{track.title}</span>
        <span class="lib-row__sub">
          {track.artist} · {track.album}
        </span>
      </span>
      <span class="lib-row__time mono">{track.duration ? formatTime(track.duration) : ''}</span>
      <button
        class="lib-row__del"
        type="button"
        aria-label={`Remove ${track.title}`}
        onClick={(e) => {
          e.stopPropagation();
          void removeTrack(track);
        }}
      >
        ✕
      </button>
    </div>
  );
}

function SongList({ list }: { list: Track[] }): JSX.Element {
  if (!list.length) return <p class="lib-empty">No songs.</p>;
  const context = list.map((t) => t.id);
  return (
    <div class="lib-list" role="list">
      {list.map((t) => (
        <SongRow key={t.id} track={t} context={context} />
      ))}
    </div>
  );
}

interface Album {
  key: string;
  artist: string;
  album: string;
  tracks: Track[];
  year?: number;
  cover?: Track;
}

function groupAlbums(list: Track[]): Album[] {
  const map = new Map<string, Album>();
  for (const t of list) {
    const key = trackAlbumKey(t);
    let a = map.get(key);
    if (!a) {
      const { artist, album } = splitAlbumKey(key);
      a = { key, artist, album, tracks: [] };
      map.set(key, a);
    }
    a.tracks.push(t);
    if (t.year) a.year = t.year;
    if (!a.cover && t.coverId) a.cover = t;
  }
  const albums = [...map.values()];
  for (const a of albums)
    a.tracks.sort((x, y) => (x.discNo ?? 0) - (y.discNo ?? 0) || (x.trackNo ?? 0) - (y.trackNo ?? 0));
  albums.sort(
    (a, b) => a.artist.localeCompare(b.artist) || (a.year ?? 0) - (b.year ?? 0) || a.album.localeCompare(b.album),
  );
  return albums;
}

function AlbumCard({ album }: { album: Album }): JSX.Element {
  const rep = album.cover ?? album.tracks[0];
  return (
    <button
      class="lib-album"
      type="button"
      aria-label={`${album.album} by ${album.artist}`}
      onClick={() => {
        albumKey.value = album.key;
      }}
    >
      <CoverImg track={rep} size={160} />
      <span class="lib-album__title">{album.album}</span>
      <span class="lib-album__artist">{album.artist}</span>
    </button>
  );
}

function AlbumGrid({ albums }: { albums: Album[] }): JSX.Element {
  if (!albums.length) return <p class="lib-empty">No albums yet. Import songs or link a folder to begin.</p>;
  return (
    <div class="lib-grid">
      {albums.map((a) => (
        <AlbumCard key={a.key} album={a} />
      ))}
    </div>
  );
}

function AlbumDetail({ album }: { album: Album }): JSX.Element {
  const rep = album.cover ?? album.tracks[0];
  return (
    <div class="lib-detail">
      <button
        class="lib-back"
        type="button"
        onClick={() => {
          albumKey.value = null;
        }}
      >
        ← Back
      </button>
      <div class="lib-detail__head">
        <CoverImg track={rep} size={160} />
        <div>
          <h3 class="disp lib-detail__title">{album.album}</h3>
          <p class="lib-detail__artist">
            {album.artist}
            {album.year ? ` · ${album.year}` : ''}
          </p>
          <div class="lib-detail__actions">
            <button
              class="btn cta lib-play-all"
              type="button"
              onClick={() => {
                const first = album.tracks[0];
                if (first)
                  void playTrack(
                    first,
                    album.tracks.map((t) => t.id),
                  );
              }}
            >
              ▶ Play
            </button>
            <button
              class="btn lib-shuffle-all"
              type="button"
              onClick={() => void shufflePlay(album.tracks.map((t) => t.id))}
            >
              ⇄ Shuffle
            </button>
          </div>
        </div>
      </div>
      <SongList list={album.tracks} />
    </div>
  );
}

// ---------------------------------------------------------------- header

function Header(): JSX.Element {
  const est = storage.value;
  const used = est ? (est.usage / 1048576).toFixed(0) : null;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return (
    <header class="lib-head">
      <div class="lib-head__top">
        <h2 class="disp lib-head__title">Library</h2>
        <div class="lib-head__actions">
          <label class="btn cta lib-import">
            Import songs
            <input
              class="vh"
              type="file"
              accept="audio/*"
              multiple
              onChange={(e) => {
                const el = e.currentTarget;
                if (el.files?.length) void importFiles(el.files);
                el.value = '';
              }}
            />
          </label>
          {folderPickerSupported && (
            <button class="btn" type="button" onClick={() => void linkFolder()}>
              Link a folder
            </button>
          )}
          <button class="btn btn--icon" type="button" aria-label="Close library" onClick={() => closeLibrary()}>
            ✕
          </button>
        </div>
      </div>
      <nav class="lib-tabs" role="tablist">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            class={`lib-tab${view.value === v ? ' is-on' : ''}`}
            type="button"
            role="tab"
            aria-selected={view.value === v}
            onClick={() => {
              view.value = v;
              albumKey.value = null;
              if (v === 'search') setTimeout(() => document.getElementById('lib-search')?.focus(), 0);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {(view.value === 'search' || query.value) && (
        <input
          id="lib-search"
          class="lib-search"
          type="search"
          placeholder="Search title, artist, album"
          value={query.value}
          onInput={(e) => {
            query.value = e.currentTarget.value;
          }}
          aria-label="Search the library"
        />
      )}
      {iOS && <p class="lib-note">On iPhone, add BEAT LAB to your Home Screen so Safari keeps your imported songs.</p>}
      {used !== null && (
        <p class="lib-note mono">
          {tracks.value.length} songs · {used} MB stored
        </p>
      )}
      {folders.value.length > 0 && (
        <div class="lib-folders">
          {folders.value.map((f) => (
            <button key={f.id} class="btn btn--txt" type="button" onClick={() => void reconnectFolder(f.id)}>
              Reconnect “{f.name}”
            </button>
          ))}
        </div>
      )}
      {scan.value && (
        <div class="lib-scan" role="status">
          <span>
            {scan.value.label} {scan.value.done}
            {scan.value.total ? ` of ${scan.value.total}` : ''}…
          </span>
          <button class="btn btn--txt" type="button" onClick={() => cancelScan()}>
            Cancel
          </button>
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------- views

function Artists({ albums }: { albums: Album[] }): JSX.Element {
  const byArtist = useMemo(() => {
    const m = new Map<string, Album[]>();
    for (const a of albums) (m.get(a.artist) ?? m.set(a.artist, []).get(a.artist)!).push(a);
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [albums]);
  if (!byArtist.length) return <p class="lib-empty">No artists yet.</p>;
  return (
    <div class="lib-artists">
      {byArtist.map(([artist, list]) => (
        <section key={artist} class="lib-artist">
          <h3 class="lib-artist__name">{artist}</h3>
          <div class="lib-grid">
            {list.map((a) => (
              <AlbumCard key={a.key} album={a} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Songs(): JSX.Element {
  const [sort, setSort] = useState<SongSort>('added');
  const list = useMemo(() => {
    const copy = [...tracks.value];
    if (sort === 'added') copy.sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === 'played') copy.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
    else if (sort === 'title') copy.sort((a, b) => a.title.localeCompare(b.title));
    else copy.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    return copy;
  }, [tracks.value, sort]);
  return (
    <div>
      <div class="lib-sort">
        {(['added', 'played', 'title', 'artist'] as SongSort[]).map((s) => (
          <button key={s} class={`btn btn--txt${sort === s ? ' is-on' : ''}`} type="button" onClick={() => setSort(s)}>
            {s === 'added' ? 'Recently added' : s === 'played' ? 'Recently played' : s === 'title' ? 'Title' : 'Artist'}
          </button>
        ))}
      </div>
      <SongList list={list} />
    </div>
  );
}

function QueueView(): JSX.Element {
  const q = queue.value;
  const byId = new Map(tracks.value.map((t) => [t.id, t]));
  const list = q.order.map((id) => byId.get(id)).filter((t): t is Track => !!t);
  if (!list.length) return <p class="lib-empty">The queue is empty. Play something to build it.</p>;
  return <SongList list={list} />;
}

export function LibraryApp(): JSX.Element {
  useEffect(() => {
    void initLibrary();
  }, []);
  const all = tracks.value;
  const albums = useMemo(() => groupAlbums(all), [all]);
  const current = view.value;
  const openKey = albumKey.value;
  const openAlbum = openKey ? albums.find((a) => a.key === openKey) : undefined;

  return (
    <div class="lib" data-testid="library">
      <Header />
      <main class="lib-main">
        {openAlbum ? (
          <AlbumDetail album={openAlbum} />
        ) : current === 'albums' ? (
          <AlbumGrid albums={albums} />
        ) : current === 'artists' ? (
          <Artists albums={albums} />
        ) : current === 'songs' ? (
          <Songs />
        ) : current === 'queue' ? (
          <QueueView />
        ) : (
          <SongList list={results.value} />
        )}
      </main>
    </div>
  );
}
