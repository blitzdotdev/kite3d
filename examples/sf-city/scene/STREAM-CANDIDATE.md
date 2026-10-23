# Isolated streaming viewer candidate

This is a separate experimental entry using Kite3D `createGame`. It does not replace the validated public viewer, `main.js`, `scene/export.mjs`, `dist/`, or release archives.

The packager consumes a frozen, hashed snapshot prepared by the streaming validation workflow. It admits exactly the measured selection: 153 generated features in five owner groups, four pinned authored poplars and one pinned terrain asset. Other baked candidate features are deliberately unavailable. Source coverage is the union of the original query rectangles, not their enclosing bounding rectangle. The map distinguishes that union from conservative model bounds and the loaded subset. Model bounds are not surveyed footprints, and owner groups are not geographic coverage boundaries.

Run from this example, choosing a new output directory:

```sh
node scene/stream-candidate-export.mjs \
  /path/to/frozen/adjacent-snapshot \
  /tmp/sf-stream-viewer-candidate-unique \
  /path/to/candidate-build-report.json
```

The output is provisional until the actual entry passes browser load, orbit/bookmarks, resize, tile failure/retry, interrupted loading and cleanup checks. The core adapter fixture's results do not automatically validate this new UI or its `createGame` integration. Do not publish this output merely because packaging succeeds.

The viewer uses the existing pinned runtime and importer, preflights immutable source hashes, keeps authored placements separate, and owns runtime material leases. It creates no editor UI. The empty bootstrap glTF prevents `createGame` from eagerly loading the full authored city before the runtime adapter starts. The original scene snapshot remains in the package for immutable preflight and is never overwritten.

The map uses X east and Z south in metres, with the original geographic origin and vertical datum unchanged. Navigation outside the selected model bounds reports unavailable surroundings. Gray shows source-query masks, gold the available selected model bounds, green currently loaded model bounds, and white the orbit target. Bounds may overlap and are conservative.

No hardware frame-rate, exact VRAM usage, citywide coverage, or production-ready streaming claim is made. Stored dependency and triangle caps are not decoded-memory caps. Pinned costs, pending loads and old/new overlap must be included in admission accounting before the candidate release gate is accepted.

## Local validation checkpoint

The frozen candidate 3 has passed actual Kite3D startup, bookmarks, orbit, resize, a forced HTTP 503 tile failure followed by retry, rapid bookmark navigation, a 390px-wide layout check, interrupted startup/reload, pagehide cleanup, and right-pan outside the available region followed by reentry. An observed residual-pan bookmark drift was fixed with the existing controls `stopDamping()` method, then the exact camera-return check passed. Scene and override snapshot hashes remained unchanged. Evidence is in `validation/stream-viewer-candidate.json`, with flow reports and overview, coverage, mobile and outside-region images beside it.

The candidate uses near-detail trees only. The separately validated LOD experiment is not integrated here. Admission includes the pinned assets and pending imports: five owner groups, 185,000 stored triangles, 26 MiB stored dependency budget, and 2,100 conservative draw-pass units for this frozen asset/render configuration. These limits must be remeasured when assets or render passes change.

Candidate 3 is packaged separately as `/tmp/sf-city-streaming-candidate.zip`. It contains relative public runtime files and notices. It has not been uploaded or published. The public release archives remain unchanged. Geometry quality is still procedural and approximate; this checkpoint validates navigation and bounded resource ownership rather than photographic realism.

## Integrated tree LOD checkpoint

Candidate 6 integrates the attested near/mid/far tree assets into actual camera navigation. Selection uses camera distance to the closest generated tree AABB in each active owner group, with 100 m and 220 m thresholds and 12 m hysteresis. All 46 eligible generated trees participate; the four pinned authored poplars retain their exact near assets. A Wide bookmark exercises distant detail. No extra geography is activated.

An incoming replacement stays detached while the previous owner group remains visible. At most one replacement loads at a time. Active limits remain five owner groups, 185,000 stored triangles, 26 MiB and 2,100 conservative pass units. Separate reservation limits include the incoming replacement: six reservations, 270,000 stored triangles, 34 MiB and 3,420 pass units. Observed peaks were six reservations, 249,059 stored triangles, 35,376,744 bytes and 3,420 estimated pass units; active estimates never exceeded five groups or 2,088 units. These are source-cost estimates, not decoded memory measurements.

The actual viewer passed two complete near/mid/far routes, reversal during replacement, deliberate hash corruption and retry, changed original near-asset rejection, disposal, and pan-out/reentry. After explicit completed-frame settling, repeated north views held 263 GPU geometries and 31 textures; overview and wide held 276 and 31. The material pool held five leases, 15 images, 18 texture states and 45 materials. Final source and pool maps were empty. The earlier poll-only comparison failed because GPU uploads had not completed; the exact-equality requirement was retained and passed with rendered-frame settling.

The frozen LOD snapshot extends `assets.json` with six deterministic candidate keys. Every original registry entry is preserved. The original scene, overrides and generated placement manifest remain byte-identical to candidate 3. Each LOD attests the original glTF, buffer and texture dependencies. This extends the registry, so its hash intentionally differs from candidate 3.

Evidence is in `validation/stream-viewer-lod-candidate.json`, the transition, retry and reentry reports, and north/overview/wide screenshots. `/tmp/sf-city-streaming-lod-candidate.zip` is a separate locally validated package; all three prior archives remain byte-identical. Nothing has been uploaded or published. The exporter now requires the frozen snapshot containing the attested LOD manifest. The renderer diagnostics exports are read-only inspection plus explicit dirty-frame requests for local validation; they do not modify authored objects.
