import { describe, expect, it } from 'vitest';
import {
  type DirHandleLike,
  type FileHandleLike,
  diffScan,
  isAudioName,
  type ScanStat,
  walk,
} from '../../src/library/scan';

type HandleLike = DirHandleLike | FileHandleLike;

function fileHandle(name: string, content = 'x'): FileHandleLike {
  const f = new File([content], name);
  return { kind: 'file', name, getFile: () => Promise.resolve(f) };
}

function dirHandle(name: string, children: Record<string, HandleLike>): DirHandleLike {
  return {
    kind: 'directory',
    name,
    async *entries() {
      for (const [n, h] of Object.entries(children)) yield [n, h] as [string, HandleLike];
    },
  };
}

async function paths(dir: DirHandleLike): Promise<string[]> {
  const out: string[] = [];
  for await (const e of walk(dir)) out.push(e.path);
  return out.sort();
}

describe('isAudioName', () => {
  it('keeps the supported audio extensions and nothing else', () => {
    for (const ok of ['a.mp3', 'a.M4A', 'a.aac', 'a.flac', 'a.ogg', 'a.opus', 'a.wav'])
      expect(isAudioName(ok)).toBe(true);
    for (const no of ['a.txt', 'cover.jpg', 'a.lrc', 'notes.md', 'a']) expect(isAudioName(no)).toBe(false);
  });
});

describe('walk', () => {
  it('recurses nested folders and yields only audio files, with relative paths', async () => {
    const root = dirHandle('root', {
      'a.mp3': fileHandle('a.mp3'),
      'readme.txt': fileHandle('readme.txt'),
      'cover.jpg': fileHandle('cover.jpg'),
      sub: dirHandle('sub', {
        'b.flac': fileHandle('b.flac'),
        deep: dirHandle('deep', { 'c.ogg': fileHandle('c.ogg') }),
      }),
    });
    expect(await paths(root)).toEqual(['a.mp3', 'sub/b.flac', 'sub/deep/c.ogg']);
  });

  it('yields entries whose getFile resolves the underlying File', async () => {
    const root = dirHandle('root', { 'song.wav': fileHandle('song.wav', 'hello') });
    const entries = [];
    for await (const e of walk(root)) entries.push(e);
    const file = await entries[0].getFile();
    expect(file.name).toBe('song.wav');
    expect(file.size).toBe(5);
  });
});

describe('diffScan', () => {
  it('reports added, changed (size or mtime) and removed files', () => {
    const prev: ScanStat[] = [
      { path: 'a.mp3', size: 1, lastModified: 10 },
      { path: 'b.mp3', size: 2, lastModified: 20 },
      { path: 'c.mp3', size: 3, lastModified: 30 },
      { path: 'd.mp3', size: 4, lastModified: 40 },
    ];
    const cur: ScanStat[] = [
      { path: 'a.mp3', size: 1, lastModified: 10 }, // unchanged
      { path: 'b.mp3', size: 9, lastModified: 20 }, // size changed
      { path: 'c.mp3', size: 3, lastModified: 99 }, // mtime changed
      { path: 'e.mp3', size: 5, lastModified: 50 }, // added
    ];
    const d = diffScan(prev, cur);
    expect(d.added.map((x) => x.path)).toEqual(['e.mp3']);
    expect(d.changed.map((x) => x.path).sort()).toEqual(['b.mp3', 'c.mp3']);
    expect(d.removed.sort()).toEqual(['d.mp3']);
  });

  it('treats a first scan (no previous) as all added', () => {
    const cur: ScanStat[] = [{ path: 'a.mp3', size: 1, lastModified: 1 }];
    expect(diffScan([], cur).added).toHaveLength(1);
  });
});
