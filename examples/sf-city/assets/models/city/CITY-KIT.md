# North Beach city asset kit

Version 5 retains 419 DataSF footprints, 74 street records, 191 mapped trees and existing owner edits. Family assignment is deterministic but heuristic, not a facade survey.

- Timber: projecting three-sided bays, framed front and side windows, cornices.
- Stucco: flat-window elevations and simpler parapets.
- Masonry: brick-scale relief and mortar joints, framed openings and cornices.
- Original shared 512-pixel color, normal and roughness maps use two metres per repeat. No external texture-pack assets were copied.
- Three broadleaf crown variants share an alpha-tested leaf atlas and actual branch geometry. Shapes are approximations, not species reconstructions.
- Original lantern and litter-bin models use heuristic sidewalk placement, excluding building interiors, other carriageways, crossing approaches and nearby duplicates. They are not mapped inventory records.

Assets remain individually editable with stable IDs. Runtime batching preserves authored objects. The Grant photo study remains a separate high-detail reference.

Ground still interpolates older footprint heights, not LiDAR. Streets retain clipped road/sidewalk meshes and heuristic crossing ramps. Surveyed junction returns, production LOD/streaming and integrated navigation physics remain unfinished.

Validated checkpoint: 775 editable placements, including 86 inferred props; 164 stucco, 133 masonry and 122 timber family assignments. Twenty-eight inventory tree positions conflicted with inferred carriageways and were moved to viable sidewalks. Original source positions and correction reasons remain in the generated manifest; none were unresolved in this build.

Local checks: nine established script tests passed. Asset references and material indices were checked. Overview, park and eye-level Columbus views rendered; camera-shadow tracking and Stop listener cleanup passed. Software-rendered browser launch to overview capture took 148.8 seconds (includes initial reference view setup); eye-level capture completed at 158.5 seconds. Visible scene traversal counted 1,462 mesh objects, not measured GPU draw calls. No production FPS claim is made.

The broad images expose remaining major work: real park paths/landmarks, more varied roof/building silhouettes, richer street markings/activity, and lower load/render cost. No GitHub CI or push was used.

## Park and landmark iteration (locally inspected)

The next generated layout traces the kidney-shaped lawn and surrounding circulation from the July 2018 SF Rec & Park concept plan. Planting pockets, thirteen separate benches, four approximate poplars and the Franklin monument base are editable assets. The concept drawing is not to scale or an as-built survey; alignment uses three existing street corners. The sculpture, playground and restroom are not reconstructed. Source URLs and methods are in `scene/sources/park-landmark-provenance.json`.

Saints Peter and Paul Church retains its mapped footprint and identity. An original approximate facade, pitched nave roof, rose window and twin spires replace the generic facade. Published 191-foot spire height constrains the silhouette; ornament, hidden sides and opening depth are inferred. Neither the church photograph nor the park drawing is redistributed.

The generated scene now has 794 editable placements and 705,639 generated triangles. A first park capture exposed intersecting terrain and large ground triangles. The correction removes underlying ground inside the park boundary and subdivides park surfaces before sampling elevation. The subsequent image verified that the large overlaps were removed. Thin lawn-edge seams remained; longest-edge subdivision then made adjacent surfaces sample their shared boundaries consistently. The standalone viewer capture verified a clean south lawn edge and no large planting-bed overlaps. Angular gray patches on the west paving still need a controlled shadow comparison.

A separately measured batching fix avoids repeatedly encoding texture images while comparing material keys. Collection time fell from 47,349 ms to 682 ms in local software-rendered profiling. This is a startup-stage improvement, not a production frame-rate result; overall loading and first rendering remain expensive. See `validation/material-batching-profile.json`.

Local validation after park changes: all ten script tests passed, including the observed startup-defect regression. The inspected park/Columbus sheet is Library version 1. Source-viewer captures completed at 101.3 seconds (overview), 107.1 seconds (park), 112.5 seconds (Columbus) and 116.2 seconds (church from lawn). Camera-shadow tracking and Stop cleanup passed. These are SwiftShader capture timings, not production performance.

The final park render is Library `libfile_bb11e5879e048191bbbff7c8f15c7060`, version 0. It shows the actual Kite3D viewer without editor UI. Normal viewer loading, orbit/zoom, bookmarks and condition-based resize checks passed; error/retry and interrupted-navigation checks are tracked separately in `scene/VIEWER.md`. Church ornament, park planting density and surrounding facades remain simplified, so this is a recognizable layout milestone rather than a photorealistic result.

## Larger-area path

Do not increase coverage simply by loading more editable objects at startup. The current slice is about 501 by 334 metres and already transfers roughly 109 MB across more than one thousand requests. Its existing 128-metre ownership groups provide a useful boundary for future delivery work.

First deduplicate equivalent runtime geometry/materials and measure the full first frame independently of loading. Next produce viewer-only, prebatched tile outputs offline from the reconciled scene, retaining the individual source assets and semantic IDs for the editor. Include source/override hashes so changed owner content invalidates only affected outputs. This would remove repeated nested glTF requests and startup merging without replacing the editable project.

Only after that, add near-detail tiles and inexpensive distant building silhouettes, with explicit unload/disposal and measured download/GPU-memory budgets. Shared material atlases and a small vegetation library should be reused across tiles. Detailed vehicles and the Grant study should load near their actual location rather than determine every initial download. This is a proposed scaling sequence, not implemented streaming or LOD. No additional geography has been fetched.

## Landmark detail iteration (awaiting viewer inspection)

The church now uses original metre-scaled stone-course PBR maps, thick arched belfry walls, projecting arch moldings, stepped gables/coping, column capitals, portal jambs and recessed timber doors. These forms were compared with the previously inspected official facade photograph; dimensions beyond the published overall measurements remain estimates. Source photograph pixels are not shipped.

The reusable palm model now has curved frond stems and individually shaped pinnate leaflets instead of diamond-shaped blades. The current bounded inventory contains no palm placements, so this asset-library improvement does not change the visible city and is not presented as a measured species reconstruction.
