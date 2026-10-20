# Background scenes

The background behind the burst is a **scene**. Each mood has three scenes, and each song gets its own
seeded order of them, so two hype songs don't look the same.

| Mood     | Scenes                                   |
| -------- | ---------------------------------------- |
| None yet | Listening globe (while the mood is read) |
| Hype     | Chevrons, Speed lines, Panel tunnel      |
| Grit     | Hazard stripes, Skyline, Torn paper      |
| Dreamy   | Ripple rings, Cloud banks, Aurora        |
| Brooding | Dot matrix, Rain, Searchlights           |

Sunburst, Chevrons, Hazard stripes, Ripple rings and Dot matrix are the original five backgrounds,
ported unchanged. Sunburst is no longer in any rotation; it stays in the registry and can be pinned in the Scene Lab.

## How a scene is chosen

1. A new song starts on the Listening globe (`LISTENING_SCENE`). `SceneDirector.setSong(look)` takes a fresh
   `SongLook` seeded from the song key.
2. When the mood is read, `sceneSet(mood, seed)` shuffles that mood's three scenes with the song's seed.
   The same song always gets the same order.
3. The dimension picks a slot in that order: Inkfall and Riso Heat show the first scene, Pressline the second,
   Static Bloom the third.
4. Every change crossfades over 1.2 s.

## What a scene reads

`SceneInput` gives a scene:

- `dc`: the frame's `DrawContext` (audio features, dimension, plates, calm, motion)
- `look`: the song's `SongLook` (seed, energy, brightness, bpm, cover palette)
- `alpha`: the overall background strength (same formula as before)
- `kick`: the beat envelope
- `rings`: the live beat rings
- `flash`: a callback that asks the flash budget for one flash

`LookTracker` keeps `look` current. Mood reads set targets for energy (arousal) and brightness (valence),
and the values glide toward them over about 2 s, so a late AI result never makes the background jump.

## The listening globe

`globe.ts` draws a dotted 3D sphere: latitude rings of dots, rotated and projected, with near dots bigger and
brighter. Each ring's radius follows a spectrum bar (`ringBar`): the equator listens to the bass, the poles to the
treble. Kicks turn it a little further, and strong beats send a paper-white scan band up it.

The dots are sorted into six depth groups and each group is one fill, so the full-screen globe costs about nine
fills a frame, not one per dot. `layoutGlobe` writes into a reusable `GlobeBuffer`, so a frame allocates nothing.

`src/ui/listening-orb.ts` is the same globe at chip size, for the "Reading mood" chip. It has no loop of its own:
call `orb.draw(t, bars, color, reducedMotion)` from an existing frame callback while the chip is shown.

The idea of an honest-3D dotted orb comes from
[thinking-orbs](https://github.com/RareFormLabs/thinking-orbs) by Jakub Antalik (MIT). No code was copied;
this is a separate implementation in BEAT LAB's print style.

## Cover colours

`extractPalette(pixelsOf(bitmap))` pulls three ink colours from embedded cover art (k-means, at least 28°
apart in hue). It returns `null` for nearly greyscale covers, and the dimension keeps its own plates.
`tintDim(dim, palette, strength)` moves the plates toward the cover's inks. Use 0.35 for Inkfall, which should
stay mostly monochrome, and 0.6 for the other dimensions. Don't extract from the generated comic cover, because
its colours already come from the dimension.

## Rules every scene follows

- Print grammar only: halftone dot fills from `pat.dots`, the three plates, a misregistered second ink
  (`dc.off`), paper-white highlights. No gradients standing in for ink.
- Generic subjects only. No real landmarks, logos or characters.
- Anything that lights the screen (Rain's lightning) must get permission from `input.flash()`, and must not
  run when `dc.calm` is on.
- Draw many small marks as a few batched paths (as the globe and rain do), not one fill per mark.
- Motion scales with `dc.motion` and slows to 0.35 in calm mode.
- Layouts come from `sceneRandom(look.seed, '<scene id>')`, never `Math.random()`, so a song looks
  the same each time it plays.

## Adding a scene

1. Write a class that implements `Scene` in the mood's file (`hype.ts`, `grit.ts`, `dreamy.ts`, `brooding.ts`).
2. Add its `SceneDef` (id, mood, name, blurb, create) to that file's export, and add the id to `SceneId` in `types.ts`.
3. Open the Scene Lab, pin the scene and check it in every dimension, in calm mode, and on a phone-width window.
4. `tests/unit/scenes.test.ts` expects exactly three scenes per mood. If a mood gets a fourth, update
   `sceneIndexForDim` and the test together.

## Scene Lab

`npm run dev`, then open <http://localhost:5173/tools/scene-lab/>. You can:

- watch a song start: the lab "reads the mood" for 6 seconds on the globe, then moves into the mood's set
- pin any scene, or let Auto play the song's set
- change dimension, energy, brightness, tempo and dose
- turn on calm mode
- try sample covers or your own image
- play a real audio file through the real beat detector

The lab is a dev tool. `vite build` doesn't include it.
