# Standalone Kite3D viewer

`npm run city:export` creates `dist/`, a static, viewer-only build. It uses the pinned Kite3D `createGame({base, canvas, onError})` runtime. No editor page or editor bundle is included.

For local inspection:

```sh
npm run city:export
python3 -m http.server 8712 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8712/`. Drag to orbit, scroll to zoom, or use the view buttons and number keys. The viewer observes canvas size changes through the supported ThreeViewer runtime. A failed load shows a retry button; retry starts a fresh document so failed imports and interrupted WebGL state are not reused.

The deployment payload is only the contents of `dist/`. The exporter follows reachable scene asset references, preserves their resource mappings, and emits a private upload manifest at `.kite3d/release.json`. Do not upload `.kite3d/`, repository sources, generator scripts or the workspace. Hosting should serve the directory entry point and its relative paths, with standard JavaScript, JSON, glTF, binary and image MIME types.

The full editable project remains in Kite3D. This is a separate runtime presentation of the same scene, not a migration to plain ThreePipe. `scene/viewer-entry.js` owns the page loading/error state; `main.js` continues to own city runtime behavior and cleanup.

No deployment is performed by the export command. The prior Teenyapp service denial remains unresolved; a successful local export is not a hosted share URL.

The local runtime adds an opt-in `renderDuringLoad: false` to `createGame`. The exported viewer uses it to avoid rendering thousands of intermediate authored meshes before city batching finishes. It restores the prior rendering state even on startup failure. Other projects retain the existing default. This requires the locally rebuilt engine runtime; it is not a published engine upgrade. Startup code using this option must not wait for a rendered frame.

## Local validation, October 22

The exported viewer passed normal loading with one HUD and no editor, orbit/zoom, keyboard bookmarks, resize of both canvas and camera aspect, a deliberately failed registry request with a retry screen, recovery with one HUD, and navigation away during startup without a page crash. There were no uncaught page errors; the only failed request was the intentional registry abort. The report is `validation/viewer-validation.json` and the inspected screenshots are `validation/overview-viewer.png` and `validation/park-viewer.png`.

SwiftShader reached the ready state at 66.3 seconds and a responsive confirmation at 96.9 seconds. The run transferred 108.9 MB over 1,065 requests. These measurements are not hardware-GPU performance. The pre-first-frame scene contained 1,569 visible meshes and 1,213 material instances, not measured draw calls or shader programs. Startup and rendering costs still need reduction.

The final metadata-only export refresh contains 1,067 files and 109,306,432 bytes. No deployment or GitHub CI was used.

Public glTF and JSON copies omit formatting whitespace; their parsed values remain identical to the editable sources. The export also carries `NOTICES.txt` and the required license texts from `scene/public-notices/`. Neither operation changes the source assets or the preserved release ZIP.

## Runtime resource sharing

The runtime keeps authored objects and textures intact. Generated tree parts use exact geometry-content keys; generated surfaces merge within ownership tiles only when complete material state matches. Runtime material clones share equivalent texture resources. Custom shader callbacks, unknown owner metadata, sampling/UV differences and changed image content stay distinct.

Kite's asset resolver creates separate blob URLs for repeated imports of the same PNG. URL identity therefore cannot detect these copies. Before batching, the runtime compares exact encoded bytes from already loaded local blob URLs, grouped by registered source path. It never trusts the source path alone. Revoked or changed blobs remain independent. This preparation runs once during startup, not every frame; Stop disposes runtime materials without disposing authored textures.

Local full-frame profiling is recorded in `validation/runtime-performance.json`. On the controlled old-tree candidate, sharing reduced steady overview draw calls from 4,683 to 2,527 and GPU textures from 2,715 to 73. The preserved published checkpoint measured 4,965 calls. Counters include shadow and postprocessing passes, not only the final fullscreen pass. The encoded-byte preparation took 14.58 seconds in this software-rendered run; ready occurred at 73.25 seconds and the first frame at 75.67 seconds. This is a rendering-resource improvement, not a claim of fast loading or hardware-GPU frame rate. Shadows still update every rendered frame, and the city still has no streaming or distance LOD.

The final corrected-tree candidate measured 2,125 steady full-frame calls and 73 GPU textures, with 685 visible meshes, 138 material instances and six instanced meshes representing 382 tree-part instances. Ready occurred at 57.95 seconds and the first full frame at 60.38 seconds. Static CPU/submission measurements were 179.6–190.1 ms; orbit measurements were 182.3–246.8 ms. These are small local SwiftShader samples, not hardware-GPU frame rates. The increased tree detail raises full-pass triangle submissions to 5,808,319 versus 3,977,282 in the published checkpoint, a 46% increase despite fewer calls. Future culling/LOD work is still needed.

The same runtime passed all seven viewer lifecycle checks before the final foliage-only correction; the corrected geometry was then loaded, navigated, profiled and visually inspected at park and church viewpoints. `validation/viewer-optimized-validation.json` preserves the lifecycle result, and `validation/park-optimized.png` and `validation/church-optimized.png` show the corrected geometry with the HUD temporarily hidden for inspection. The final public payload contains 1,076 files and 96,528,975 bytes, including notices. Experimental tile-streaming code is excluded. The original release ZIP is preserved separately.
