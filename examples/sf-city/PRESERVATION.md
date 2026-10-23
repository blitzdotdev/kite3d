# SF preservation checkpoint, 2026-10-23

The normal example remains the editable North Beach scene and the standalone Kite3D viewer from `scene/export.mjs`. Engine versions remain pinned. This checkpoint does not claim full San Francisco coverage or photographic realism.

## Validated playable build

The preserved optimized standalone viewer archive has SHA-256 `d4db5d0cfa25f4a1ae047b84f0d9cbd061df3ba3149f25cad1ae777e92c0d65a` (36,416,278 bytes). Local browser evidence is in `validation/viewer-optimized-validation.json`. It includes loading, navigation, resize, failure/retry and cleanup. The archive is not committed as a redundant build output. A fresh export from later experimental source is not automatically this validated archive.

Local preservation checks passed: root build, typecheck, lint, and 11 focused SF/runtime regression tests. No GitHub CI was requested; preservation commits use `[skip ci]` for the repository's push/pull-request workflow. No workflows or engine dependencies were changed.

## Separate streaming experiments

`scene/stream-candidate-*`, the static tile adapter/preflight, resource pool and tree LOD assets are isolated experiments. The 153-feature LOD viewer passed repeated navigation, failure/retry, cancellation and resource cleanup. A later narrow shadow sampler repair passed 12 alternating chunk loads, LOD cancellation and a pixel-identical foliage-shadow comparison. These are not the deployed full-scene viewer.

## Unfinished citywide work

The neighborhood admission/executor, projected-detail selection, expanded-profile entry, building trim variants and vehicle simplification generators are work in progress. Integrated complete-neighborhood navigation and final performance budgets are unfinished. The complete eligible 853-feature profile excludes four authored exceptions and must not be described as the whole authored scene.

Same-camera profiling reduced draw calls from 5,215 to 2,970 by grouping the same eligible features by 21 semantic owners with 128 metre batches, versus 83 smaller groups. Submitted triangles increased about 2.6 percent. These are software-rendered diagnostics, not user-hardware FPS.

Public source acquisition retains three successful adjacent captures and the accepted first citywide batch of 40,000 raw records. Partial pages do not establish complete geographic coverage. A later batch failed after repeated HTTP 503 responses; its diagnostic raw bytes remain local and are not an accepted snapshot. The 69 valid building geometries outside the provisional envelope remain review-needed; the envelope is not an authoritative municipal boundary.

Original authored assets, semantic IDs, overrides, provenance and licenses are retained. Restricted reference-photo pixels, private hosting configuration, credentials, local session/checkpoint files and temporary builds are excluded. No Site deployment is implied by this commit.
