# Staged San Francisco coverage

This folder implements an **offline plan**, not a city generator or streaming runtime. Run from any working directory:

```sh
node /path/to/kite3d/examples/sf-city/scene/coverage/plan.mjs
```

It writes deterministic `plan.json` with the current snapshot provenance, explicit planning envelopes, stable tile ranges, proposed budgets, a manifest contract and 16 bounded acquisition cells (partial snapshot borders first, then adjacent cells). It makes zero network requests and generates no geometry. Only North Beach, approximately 501 by 334 metres with 419 buildings, 74 streets and 191 mapped trees, is currently built. A planning envelope is neither a measured municipal boundary nor new coverage.

## Coordinates and identity

Reuse the existing `scene/data.mjs` mapping: origin `[-122.40935, 37.8005]`, X east, Z south, metres based on the fixed-origin equirectangular approximation. Y remains NAVD88 ground height minus the existing 15-metre vertical origin; do not substitute GPS ellipsoid height. Tile IDs are `floor(x/128)_floor(z/128)`, including negative coordinates. Do not reset the world origin at every acquisition batch. Near-camera rendering may use a reversible camera-relative offset later, but persistent scene and source coordinates stay unchanged.

The approximation is retained to avoid moving existing edits. It is not a surveyed citywide CRS. Before integrating LiDAR or another projected source, implement and verify an explicit datum/CRS transformation against control points, including vertical datum, rather than relabeling the current coordinates.

Keep original dataset feature IDs. An intersecting road/building can appear in several query responses: deduplicate the complete source record by ID, preserve a canonical owner recorded in the manifest, and keep neighboring tile references. Never assign IDs from query row order or clipped fragments. Existing owner assignments remain authoritative even if a later source geometry changes its centroid; any ownership migration must be explicit and retain edits.

## Geographic scope

The mainland planning envelope covers the peninsula through the southern city edge; separate Treasure/Yerba Buena and Alcatraz envelopes are explicit. These are deliberately broad author-selected acquisition boxes and include water or neighboring jurisdiction cells. They require an official land/jurisdiction mask before bulk acquisition or generation. The output reports **11,157 envelope tiles**, not 11,157 populated tiles, and leaves land-tile count unknown.

Farallon Islands are explicitly deferred to a separate region/coordinate strategy. Thus this is a staged path to citywide urban coverage, not a claim that every part of San Francisco's legal territory is included. The official [Treasure Island Development Authority](https://www.sf.gov/departments--city-administrator--treasure-island-development-authority) provides context for the island district. Boundary geometry and its provenance still need acquisition; none is invented here.

## Acquisition sequence

1. Finish the optimized playable North Beach baseline and measure interaction frame times separately from loading.
2. Complete the partial border cells of the existing snapshot first, then add adjacent cells, at most the 16 total 128-metre cells listed in `plan.json`. Four existing DataSF layers per cell produce a maximum of 64 initial requests, with concurrency capped at two. No such requests have been issued by this module.
3. Stage responses outside the accepted snapshot until all layers validate. Record request URL, capture timestamp, dataset ID, content hash, record count and source `data_as_of`. Preserve valid empty, denied, failed and truncated states separately.
4. A full 5,000-row response is not proof of completeness. Subdivide spatially or page with deterministic ordering and check duplicate/missing IDs before accepting. Mutable endpoints can change between pages, so capture source timestamps and reject inconsistent batches rather than claiming a transactional snapshot. See the official [Socrata paging guide](https://dev.socrata.com/consumers/getting-started.html) and [LIMIT documentation](https://dev.socrata.com/docs/queries/limit.html).
5. Build offline using reconciled source records and owner overrides. Keep individual named assets editable. Generate a tile manifest with source/override/generator hashes and detail-level byte/triangle counts. Runtime batching is a reversible presentation; it must not overwrite authored files.
6. Validate a continuous route across the old/new boundary, then travel far enough to unload and return. Verify no duplicated boundary features, no persistent tile gaps, stable camera/world coordinates, correct terrain/street contact and preserved editor edits. Only then increase the acquisition ring.

Existing source catalogs: [buildings](https://data.sf.gov/resource/ynuv-fyni.json), [streets](https://data.sf.gov/resource/3psu-pn9h.json), [trees](https://data.sf.gov/resource/tkzw-k3nq.json), [sidewalks](https://data.sf.gov/resource/4g86-grxu.json). The queries use the same selected fields as `scene/fetch.py`; they are not a newly validated bulk data contract. No paid data, new credentials, hosting or dependencies are involved.

## Streaming acceptance contract

`plan.json` proposes a 20 MB initial transfer, 384 MB resident GPU budget, nine near tiles, at most 25 resident detail tiles and two concurrent tile loads. Full-frame draw calls target 500 and interaction targets 33.3 ms. These are **targets to test**, not achieved performance or promises for every device. Count shadow, depth, AO and transmission work, not just the last fullscreen pass.

A tile goes through `not-acquired`, `source-ready`, `generated`, `validated` or `failed`. A runtime loader must use generation tokens or cancellation so a late response cannot reattach an unloaded tile. Attach complete tiles atomically. On unload or Stop, remove runtime objects/listeners and release owned geometry; reference-count shared materials/textures so unloading one tile does not break another. Failures need visible retry behavior while retaining already loaded tiles. No such loader is implemented in this folder.

A usable first expansion is one adjacent ring with a small coverage map showing loaded/loading/failed tiles and a camera destination marker. Distant silhouettes can follow once geometry simplification, shared materials and ownership are validated. Do not download all citywide detailed geometry and merely hide it by distance.

## Bounded acquisition CLI

`acquire.mjs` now implements a single-tile capture path. Its default is a dry run with no writes or network:

```sh
node scene/coverage/acquire.mjs --tile 0_0
```

After the optimized baseline is accepted and the selected acquisition is authorized, explicitly opt into live acquisition:

```sh
node scene/coverage/acquire.mjs --tile 0_0 --fetch
```

There is no `--all` or implicit loop over planned coverage. Each invocation accepts exactly one tile within the planning envelopes, requests the four existing layers with concurrency two, a 90-second timeout per request, a 32 MiB response budget and a 5,000-row completeness guard. It does not retry denied or failed requests or follow redirects. No live acquisition was run while implementing this CLI.

For offline validation or importing already captured responses:

```sh
node scene/coverage/acquire.mjs --tile 0_0 --import-dir scene/sources --output /tmp/sf-captures
```

Imports require `provenance.json` with `area.bounds`; supplied layer hashes are verified. Complete records are spatially filtered to the selected cell without clipping their geometry. Identical duplicate semantic IDs are deduplicated; conflicting records with the same ID fail validation. When the imported snapshot does not contain the entire tile, the candidate is `partial-source`, even if every imported record is valid. It cannot silently claim completion of a border tile from the smaller North Beach snapshot.

Every invocation writes an immutable, uniquely timestamped capture directory under `captures/` by default, assembling it in a staging directory and renaming it only after all layer results and its manifest are recorded. Failed attempts retain explicit per-layer states (`denied`, `failed`, `invalid`, `truncated`, `oversized` or `conflict`) separately from successful `empty` responses. A failure never overwrites an accepted capture, `scene/sources/`, the scene, overrides or registrations. The CLI exits unsuccessfully for failed or partial-source candidates. `captures/` is locally ignored; review provenance and deliberate inclusion separately before shipping source data.

`tile-manifest.json` records source-ready status only when all four layers validate and the imported extent covers the full tile. It includes query URLs, capture/receive times, input and normalized payload SHA256 values, dataset `data_as_of` values, semantic feature IDs, source-record hashes and owner/cross-tile roles. Existing generated owner assignments remain authoritative. New owners use the full source feature's anchor, never a clipped query fragment. Geometry is explicitly `false` and `assetsByDetail` remains empty: source-ready does not mean rendered, streamed, navigable or geographically verified land.

Manual offline validation used the existing raw snapshots, temporary output directories and a mocked fetch function. It covered dry-run, successful import (93 source records for tile `0_0`), partial snapshot extent, valid empty responses, bad provenance/content, row truncation, duplicate/conflicting IDs and HTTP denial. The mock observed four requests with maximum concurrency two and no retries. Baseline source, scene registry and override hashes were unchanged; no live network request occurred. No new test framework or dependency was added.

### Acquisition validation before publishing a layer

Tree coordinates accept finite numeric values or nonempty numeric strings in geographic range. Null, blank strings, booleans, arrays and objects are rejected. Imported provenance bounds must be four finite numbers in west/south/east/north order and geographic range. Roads and the existing sidewalk-width source accept LineString geometry; buildings accept Polygon or MultiPolygon. Geometry validation checks coordinate nesting, finite positions, line extent, ring closure, distinct ring vertices and nonzero ring area. This is structural validation, not a complete GIS topology repair or self-intersection certification.

Ownership anchors and all candidate features are validated before a layer payload or success state is published. Invalid layers contribute no partial features. Manual temporary fixtures rejected 21 malformed inputs and confirmed that a failed building layer had neither features nor a payload. The unchanged snapshots still import tile `0_0` as source-ready with 93 source features. Prior dry-run, empty, partial-source, conflict, cap and mocked-denial/concurrency checks still pass. No live acquisition was performed.

### Candidate runtime asset inspection

```sh
node examples/sf-city/scene/coverage/runtime-manifest.mjs /tmp/sf-runtime-candidate.json
```

This read-only inspector derives a candidate manifest from the current saved scene, asset registry and generated ownership map. It does not change the viewer or implement streaming. The default output is ignored `coverage/captures/runtime-candidate.json`.

- Each semantic feature occurs once, under its existing owner tile. Authored objects without an owner are explicitly unassigned and must remain resident until assigned. Ownership does not change when a user moves a feature.
- Saved scene hierarchy transforms and actual registered replacement asset references determine world bounds and dependencies. Conservative static POSITION accessor bounds are transformed through both asset and scene hierarchies. Geometry bounds can cross many ownership cells and must inform future load selection; owner cells are not clipping boundaries.
- Asset keys reference exact registry files. Shared textures and buffers have one dependency record with byte size and SHA-256. Per-cell cold byte totals count each dependency once within that cell; summing those totals across cells double-counts shared dependencies. A future loader needs reference-counted shared dependencies.
- Counts include triangle primitive instances in the current default asset scene. They exclude shadow/effect passes and are not measured draw calls, frame time, GPU memory or decoded texture size. Material slots are local indices, not evidence of equivalent material identity.
- Unsupported nested root references, dynamic/skinned/morph geometry, missing POSITION bounds, missing registrations and out-of-project dependency paths fail inspection rather than inventing estimates. Inline main-scene meshes are explicitly listed as excluded. Input scene/registry/ownership/override hashes are checked again before output to catch concurrent edits.

Local inspection of the current North Beach checkpoint produced 794 features, 20 owner cells, 506 unique registered assets, 97,512,396 stored dependency bytes and 1,433,661 visible static triangles. There were no unassigned features or excluded inline meshes. Twenty-seven dependencies were shared across cells. The largest cell's cold dependency set was 48,633,406 bytes, showing why loading a cell must share cached resources and why the current asset payload needs improvement before geographic expansion. Two derivations were byte-identical; manual checks verified unique ownership, finite world bounds and dependency closure. These are checkpoint measurements, not budgets met or full-SF coverage.

### Existing environment proxy configuration

On Node versions that support `--use-env-proxy`, built-in fetch only adopts the environment's HTTP/HTTPS proxy configuration when this flag (or `NODE_USE_ENV_PROXY=1`) is enabled. In a managed environment with an existing approved proxy, use:

```sh
node --use-env-proxy examples/sf-city/scene/coverage/acquire.mjs --tile -1_-2 --fetch
```

Keep the existing proxy, NO_PROXY and CA settings; do not print their values, disable certificate verification or substitute another network route. Check flag support on older Node versions before use. A transport error with no HTTP response is not evidence of a service access denial. The capture records the transport cause code when available. Do not automatically retry either transport failures or HTTP denials.

For an explicitly authorized retry of a failed capture, `--fetch --retry-from <capture-directory>` reuses hash-verified valid/empty layer payloads and requests only layers whose prior HTTP status was 503. It rejects changed queries, different tiles, other failure statuses, and attempts before Retry-After (or a 30-second fallback) has elapsed. Retry-After seconds/date headers are retained in new failure manifests. No automatic retry loop runs. The new immutable capture records its predecessor and reused payload provenance; it never modifies the previous capture. Stop and report repeated 503 responses. Manual mocked checks verified two-request retry, reuse of both valid layers, future Retry-After rejection and rejection of a 403 retry, with zero live requests in those checks.

### Isolated adjacent geometry candidate

```sh
node examples/sf-city/scene/coverage/candidate-build.mjs /tmp/sf-adjacent-candidate <source-ready-capture-directory> [more-capture-directories...]
```

The destination must be a new `/tmp` directory. The script copies the example without dependencies, exports, editor state or acquisition captures, then links the existing repository dependencies. It merges captured source records by stable source ID; existing records win conflicts, which are listed in the report. It copies authored scene/overrides, preserves existing owner IDs, runs the current offline generator and composer, and derives a candidate runtime manifest. Baseline input hashes are checked afterward; nothing writes back into the accepted project.

The adapter accepts up to 16 source-ready captures and always starts from the accepted original project. It rejects chaining from a previous candidate, whose expanded bounds are only an iteration envelope. The exact baseline coverage masks plus captured rectangles are partitioned into nonoverlapping rectangles by subtraction; uncovered corners and disconnected gaps remain empty. Duplicate/order-independent mask checks cover these cases. Captures merge in deterministic capture-ID order; baseline records win, then earlier captures win conflicts, with each conflict recorded. In the workcopy, building/tree selection uses the exact union mask. Road and ground triangles are clipped against its disjoint rectangles, including interpolated UVs/normals. Whole mapped building footprints remain intact at boundaries. The generator rebakes all ground-contact geometry coherently using the merged elevation samples; it must not be combined with the old terrain. Terrain remains monolithic and requires temporary residency in the streaming prototype. Collision metadata is still an unintegrated envelope draft and must not be used as masked physics geometry.

The first `-1_-2` candidate added 11,394.56 square metres and 68 placements: 40 buildings, 5 roads, 16 trees and 7 inferred street props. Two overlapping road source records differed; baseline records were retained. Existing owners and the overrides file were preserved, and 74 explicit saved scene edits survived composition. The church and photo-study overrides remain. Coherent regeneration changed 100 baseline asset glTFs inside the isolated workcopy; generated-asset manual changes require review before adoption.

Local binary-geometry inspection verified all 67,629 road/terrain triangles lie within a single union-mask rectangle. Candidate manifest totals were 862 features, 21 owner cells, 102,535,169 stored dependency bytes and 1,545,775 visible static triangles. These are offline checks only. Streaming traversal, unload/reload, visual ground/road seam inspection and performance validation are required before accepting or deploying this candidate. No expanded coverage has yet been promoted to the baseline.

The next source-only capture, `0_-2`, completed with four HTTP 200 responses: 79 buildings, 14 roads, 22 trees and 14 sidewalks. It remains staged separately; the active candidate has not been expanded with this capture. Counts across captures overlap and must be deduplicated by semantic identity before reporting city coverage.

Together the two captured cells add 22,789.12 square metres of source coverage outside the original rectangle. Only the first 11,394.56 square metres has been baked into the isolated candidate. A technical browser prototype has rendered 153 features selected by geometry bounds across five owner IDs, with the monolithic terrain and four authored park poplars pinned separately. This is a partial streaming validation scene, not an expanded published demo or completed citywide coverage.

### Experimental runtime release gate

`lib/tile-streaming.js`, `lib/tile-preflight.js` and `lib/tile-material-pool.js` are isolated runtime experiments, excluded from the accepted standalone export. The default controller allows two concurrent imports, nine near cells and twelve resident cells, with conservative limits of 1.5 million stored triangles and 128 MiB of stored dependencies. These are not GPU memory or complete-frame draw-call limits. Pinned terrain and authored assets must be accounted for separately. No larger active footprint should be accepted from these limits alone.

Before promotion, compare the same camera, visible objects, shadows, effects and renderer settings with and without pooling/batching. Include complete-frame draw calls, shadow submissions, interaction timings, geometry/texture allocation plateaus, pinned overhead and load costs. Repeat tile transitions, including unloading the original source of shared textures first, cancelling pending loads and crossing tree detail thresholds. Final resource counts should return to the viewer's measured environment/effect baseline, not necessarily zero. Owner-edited assets and unknown state must retain their original rendering path. Source masks, semantic IDs and editable scene files remain authoritative.

The isolated texture ownership fixture passes: after disposing the original imported texture and revoking its blob URL, a surviving tile can upload the pool-owned image again with unchanged rendered pixels. Releasing the final lease leaves no pooled images, textures or materials. This fixture does not establish full-scene performance, complete transition stability or deployment readiness.

The first actual-city pool run exposed a no-op: the pinned loader restores `userData.gltfExtensions` as an enumerable `undefined` property when no extension exists, which the conservative metadata guard rejected. The compatibility exception now covers only that absent loader slot on a plain metadata object. Custom callbacks, shader extensions, nonplain metadata and unknown undefined owner fields still bypass pooling. Shared materials retain their actual canonical texture/image dependencies; automatic texture matrices are not treated as independent authored sampler state. Sheared world transforms bypass instancing and use transformed geometry or the original mesh so r163's instance-normal approximation cannot corrupt lighting. These changes require real imported-asset and repeated-transition validation, not only synthetic pool tests.

The corrected real-import fixture shares seven texture states and five materials across two independent building/tree imports. Settled allocations remain eight geometries and thirteen textures after disposing the first import and reuploading the survivor's owned textures. Before/after sampled image hashes match; an intervening no-unload control differs by one color byte at one level, with identical camera matrices. No tolerance was added to classify a broken image as correct. Source hashes, semantic transforms and sheared-normal handling pass, and final pool entries are zero.

In the fixed 153-feature city prototype, pooling alone reduces GPU texture allocations from 452 to 31 with identical renderer settings and unchanged 7,595 complete-frame draw calls. Two owner-transition cycles repeat the same allocation plateaus; disposal returns to fourteen geometries and eleven environment/effect textures. This is resource-sharing evidence, not an interaction-speed claim: software-rendered orbit submissions remain approximately 124 to 186 ms. Batching, distance switching and final active-area budgets remain separate release gates. Evidence is under `validation/stream-real-pool-report.json` and `validation/stream-adjacent-pooled-report.json`.

Adding tile-local batching to the same fixture reduces complete-frame calls to 616 and GPU geometry allocations from 1,934 to 188, with 31 textures. The settled unpooled control measures 129.6 ms CPU frame submission and 99.8 to 175.6 ms on the sampled orbit; the batched run measures 24.5 ms and 16.6 to 62.2 ms respectively. These SwiftShader samples are not hardware FPS or a production budget. Submitted triangles increase from 462,581 to 527,517 (64,936, about 14%) because a visible merged batch can submit members that individual frustum culling would omit. Batches remain tile-local; smaller spatial groups and explicit total admission reservations are being evaluated before viewer integration.

The isolated actual-import LOD walkthrough crosses near/mid/far thresholds over 28 distance samples and two cycles. Hysteresis results in nine imports, not one per sample. Each active level retains four GPU geometries and five textures; unloading returns to the measured two-geometry/four-texture baseline. Source-attested substitutions preserve semantic IDs and world transforms. Stopping while an actual acquired material lease awaits return does not attach the cancelled tile and leaves no pooled resources. Near/far canopy silhouettes were inspected. See `validation/stream-lod-report.json`; this does not yet certify distance switching throughout the full city candidate.

The 64 m centroid grouping option reduces excess triangle submission to 1.54% (469,701 triangles), with 1,260 calls, 276 GPU geometries and 31 textures in the same view. A source mesh crossing cells stays intact; this grouping is not geometric clipping or a guarantee that every batch bounding box is 64 m wide. It trades some draw-call savings for finer culling. Full-visible owner draw units total 509; four configured passes plus pinned content and sixteen fixed pass calls give a conservative admission estimate of 2,088. The isolated viewer candidate uses a 2,100 estimate cap, 185,000 stored triangles, 26 MiB stored dependencies and five owner reservations. Including pinned content, the current fixture reserves 180,824 triangles and 25,412,728 bytes. These source/pass estimates do not certify GPU memory or device frame time.

Reservations include imports that were cancelled but have not finished releasing, preventing immediate replacement loads from ignoring that overlap. Pinned content alone exceeding a limit is rejected; missing draw estimates fail closed when the draw budget is enabled. The state reports blocked tile reasons and waiting reservations. Runtime candidate integration and its enabled-budget browser walkthrough are validated separately from the isolated controller harness.

The separate Kite `createGame` viewer candidate is now locally browser-validated for the selected 153 features, not the complete 862-feature bake. It includes compact navigation, expandable coverage, loading/error/retry state and explicit unavailable surroundings. Forced tile failure/retry, rapid bookmarks, resize, interrupted startup/reload, real pan outside the region and re-entry pass. A pan-inertia defect was corrected by stopping supported camera-control damping before bookmark placement. Source scene/registry/generated/override hashes remain unchanged. This candidate uses near-detail trees; the isolated LOD tests are not wired into this viewer. See `validation/stream-viewer-candidate.json` for exact package hashes, checks and limits. The accepted release exporter and previously validated release ZIPs remain unchanged.

The candidate prototype caps its iteration envelope at 1,024 metres per axis, even when supplied masks are sparse. This prevents distant disconnected captures from causing a large empty bounding-grid build. Larger areas require per-tile terrain generation before this guard is relaxed.

### Current staged source coverage

The original North Beach rectangle remains `[-122.4122, 37.799, -122.4065, 37.802]`, approximately 501 by 334 metres. The first two captures (`-1_-2` and `0_-2`) add 22,789.12 square metres outside that rectangle. A third connected source-only tile, `-1_-3`, adds another 16,384 square metres. It returned HTTP 200 for all four layers on its first attempt: 72 buildings, 8 roads, 29 trees and 8 sidewalks. No retry was needed.

Total additional acquired coverage is now **39,173.12 square metres**, represented by the exact rectangle union in `source-status.json`. Only **11,394.56 square metres** has been baked into the isolated candidate, and its technical streaming viewer renders a selected subset rather than the entire bake. The two later source captures have not expanded active geometry or the published viewer. A previous candidate's expanded `area.bounds` is only an iteration envelope; it is never evidence that empty corners were acquired, generated or rendered. Capture feature counts overlap with each other and the baseline and must not be presented as newly rendered objects.

### Bounded citywide source pagination

`city-acquire.mjs` is a separate source-only capture path. Its default is a dry run. An explicit `--fetch` requests at most eight data-page positions per batch, 5,000 rows per page, with at most two layers running concurrently and a 32 MiB response cap. Count checks are additional requests. A 503 can retry once after Retry-After or a 30-second fallback; delays over 60 seconds defer the batch instead of blocking indefinitely. Authorization failures and rate limits (401, 403, 429) stop new requests without retry. Nothing changes accepted snapshots or runtime geometry.

```sh
node --use-env-proxy examples/sf-city/scene/coverage/city-acquire.mjs --fetch --max-pages 8
```

Pages retain the exact response bytes, hashes, queries, selected response headers and aliased system `:id`/`:updated_at` fields. The requested ordering is `:id ASC`. Encoded Socrata row identifiers are not compared lexicographically: the collector validates unique IDs, offsets, page lengths, counts and dataset Last-Modified continuity, not an independently verified identifier comparator. Dataset attribution and selected/schema field evidence are recorded; the license attribution is inherited from accepted snapshot provenance and explicitly labeled as such.

Each layer records start/end count and Last-Modified checks. A changed watermark makes the capture fail rather than become an accepted snapshot. Resume verifies previous manifests/pages by hash and scans ancestor row IDs for duplicates before trusting its offset. An empty terminal page plus the original total count is required for layer completion. These are observational consistency checks, not a transactional snapshot guarantee. Raw records, including invalid geometry, remain available for later quarantine and semantic validation; transport completeness must not be confused with usable city geometry.

The first live batch captured 10,000 rows from each of the four layers: **40,000 raw rows, 17,845,239 stored response bytes**, eight data requests and eight count checks. All four layers remain partial at offset 10,000. Source totals at capture start were 177,023 buildings, 16,378 active roads, 144,519 trees and 16,174 sidewalk records. The immutable manifest and its attribution/schema receipt are referenced by `citywide-first-batch.json`. No geometry was generated and no new complete geographic area can be inferred from these system-ID-ordered partial pages.

The next authorized batch would use:

```sh
node --use-env-proxy examples/sf-city/scene/coverage/city-acquire.mjs --fetch --max-pages 8 --resume examples/sf-city/scene/coverage/captures/citywide/2026-10-22T19-41-00.040Z-fdbc196a-4bac-4bb1-9c6f-fca11fb0f66a
```

No second batch was run at this checkpoint. The full sources require about 73 nonempty data pages at current counts, plus terminal-page checks, per-batch count bookends and any bounded retries. Eight count checks per batch mean total requests exceed an uninterrupted one-pass estimate. Local mocked checks cover page limits, two-layer concurrency, resume, immutable prior files, preserved invalid raw geometry, denial stop, one bounded 503 retry and watermark-change rejection. No test framework was added.

The next authorized continuation stopped after the buildings page at offset 15,000 returned HTTP 503 twice, including its delayed retry. No further batches ran. Across the original batch and preserved failed-batch evidence there are 67,552 unique raw source rows (28,749,367 bytes): 15,000 buildings, 16,378 active roads, 20,000 trees and 16,174 sidewalks. Only the original 40,000-row batch remains resumable; the additional 27,552 rows are diagnostic staging, not an accepted chain checkpoint. `citywide-progress.json` records both manifest hashes and the last resumable path. These records do not establish spatial completeness or renderable geometry.

The collector now assigns unused data-page quota to incomplete layers, including each layer's required terminal-empty check, without exceeding eight page positions. Completed layers still receive count/watermark checks. A failure stops further queued requests across layers; already in-flight responses can finish and remain in the diagnostic manifest. Mocked limits, resume, denial, backoff and watermark checks pass after this adjustment.

### Offline first-batch source validation

`validate-city-capture.mjs` audits an accepted partial/complete chain without network requests or source writes. It verifies page/ancestor hashes and transport IDs, reuses `normalizeLayer` geometry checks and `data.mjs` building-ring/area conventions, then reports semantic-ID duplicates, conflicts, observed extents and source timestamps. Reports must be written outside the immutable capture directory. Conflicting semantic IDs quarantine all conflicting copies; exact duplicate copies are retained in the raw capture and counted once for potential partitioning.

The first 40,000-row capture audit found **39,590 usable unique semantic IDs under the current envelope policy**, with **410 rows requiring quarantine/review**:

| Layer | Raw rows | Usable unique IDs | Quarantined/review |
| --- | ---: | ---: | ---: |
| Buildings | 10,000 | 9,931 | 69 |
| Active roads | 10,000 | 10,000 | 0 |
| Trees | 10,000 | 9,659 | 341 |
| Sidewalks | 10,000 | 10,000 | 0 |

All 69 building records pass structural geometry validation but lie entirely south of the current author-selected mainland envelope's 37.707 latitude edge. They require jurisdiction/envelope review, not deletion or a claim that their geometry is invalid. The 341 tree records lack both latitude and longitude. No exact duplicates or conflicting semantic IDs were found in the accepted first batch. No captured building was filtered by the generator's 20 square metre footprint threshold, and its measured-height and ground-sample fields were present.

Source `data_as_of` values remain distinct from capture/update time: buildings September 11, 2023; roads October 22, 2026; trees September 30 through October 20, 2026; sidewalks June 17, 2024. Per-layer observed geometry bounds and all quarantine references/reasons are in `citywide-first-batch-validation.json`. These broad observed extents establish **no complete geographic tiles** because the pages are a partial sequence in server row-ID order. Structural validation is not full GIS topology certification, and the planned envelopes are not authoritative jurisdiction masks. Raw files were verified unchanged after auditing.

Temporary manual fixtures verified conflict quarantine, exact-copy deduplication and invalid-coordinate handling. No test framework was added, no records were discarded, and no network requests ran during this validation.
