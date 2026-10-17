# On-device mood model — attribution and licences

BEAT LAB reads a song's mood with pre-trained models from the **Essentia** project,
run entirely on your device. Nothing here is fetched from a third party at runtime.

## Models (`mood_*-musicnn-msd-2/`)

Four MusiCNN classifiers trained on the Million Song Dataset, by the
**Music Technology Group, Universitat Pompeu Fabra (MTG/UPF)**:

- `mood_happy-musicnn-msd-2`
- `mood_sad-musicnn-msd-2`
- `mood_aggressive-musicnn-msd-2`
- `mood_relaxed-musicnn-msd-2`

Model catalogue: https://essentia.upf.edu/models.html

**Licence: Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 (CC BY-NC-ND 4.0).**
Non-commercial use only. See `LICENSE` in this directory for the full terms. The models are
vendored here unmodified. For commercial use, MTG offers a proprietary licence on request.

Each model's `model.json` + `group1-shard1of1.bin` is ~3.2 MB (≈12.8 MB for all four).

## Runtime libraries (`lib/`, `tfjs/`)

- **Essentia.js** (feature extraction + model add-on): `essentia-wasm.module.js`,
  `essentia.js-model.umd.js`. © MTG/UPF. Licence: **AGPL-3.0-only**.
  https://mtg.github.io/essentia.js/
- **TensorFlow.js** 3.5.0 core + WASM backend: `tf.min.3.5.0.js`,
  `tf-backend-wasm-3.5.0.js`, `tfjs/*.wasm`. © Google. Licence: Apache-2.0.

The `importScripts`-compatible builds of these libraries are taken from the official
Essentia.js `mood-classifiers` example.
