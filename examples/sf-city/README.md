# San Francisco city slice

An editable North Beach / Washington Square dataset and offline city baker for Kite3D. The checked-in scene contains 419 buildings, 74 street segments and 191 mapped street trees in an approximately 500 x 334 m area.

This is the first geometry and regeneration milestone. It is not at BeamNG.Earth's visual fidelity yet.

![North Beach geometry slice in Kite3D](preview.png)

## Run

From this repository, after its normal build:

```sh
cd examples/sf-city
npm run city:build
node ../../packages/kite3d/dist/cli.js dev --no-open
```

Or copy this directory into a standalone project, run `npm install`, then `npm run dev`. Open `assets/main.scene.gltf`. Play provides three camera bookmarks, instances the repeated tree models and batches the generated surfaces by tile/material. Stop restores the authored objects and camera. Each building, road and tree is independently selectable in the saved scene.

## Rebuild and improve

`npm run city:build` is offline and uses the checked-in source snapshot. `npm run city:fetch` explicitly refreshes the four bounded DataSF queries. Fetching never runs automatically during play or build. Coordinates use a local flat approximation for this bounded slice, X east, Y up, Z south, around the origin in `scene/area.json`. Vertical values are city ground heights in NAVD88 metres, minus `verticalOriginM`; they are not WGS84 ellipsoid heights.

`scene/generated.json` records source IDs, assumptions, per-feature hashes, inferred/measured fields, logical 128 m ownership groups and the asset placements. It is generated output. `scene/collision.json` contains separate terrain triangles and footprint prisms for later physics integration. The renderer does not consume that collision file yet.

Put durable changes in `scene/overrides.json`, keyed by a feature ID from the generated manifest. For example:

```json
{
  "version": 1,
  "features": {
    "sf-building:201006.0001265": {
      "heightM": 25,
      "facadeColor": "#b7c8c2"
    },
    "sf-road:2546000": {"widthM": 4, "sidewalkM": 0}
  }
}
```

Buildings and trees also accept `asset`, a project-relative path to an authored `.gltf`, and all feature types accept `hidden`. A replacement building asset uses a metre-scale, Y-up origin at the footprint vertex-average centre and generated base elevation. A replacement tree is 10 m tall before its placement scale is applied. Do not edit generated model files directly. Unchanged output files retain their bytes and modification times. Unknown override IDs are reported in `generated.json` for reconciliation after source refreshes.

The composer also preserves saved editor changes to existing placement names, TRS transforms and asset references by comparing them with their previous generated values. It preserves unknown node extras and document fields. Generation controls asset membership: use `hidden` for durable removal. Overriding a generated placement in the editor takes precedence over subsequent placement defaults until reconciled.

## Source snapshot and limits

All four layers come from the City and County of San Francisco's DataSF portal, with PDDL as recorded in its catalogue. Query URLs, capture time, dataset IDs and snapshot hashes are in `scene/sources/provenance.json`.

| Layer | Dataset | Used here |
| --- | --- | --- |
| Buildings | [ynuv-fyni](https://data.sf.gov/d/ynuv-fyni) | Footprints, median relative heights, ground elevation samples |
| Streets | [3psu-pn9h](https://data.sf.gov/d/3psu-pn9h) | Active centrelines, names and connectivity |
| Trees | [tkzw-k3nq](https://data.sf.gov/d/tkzw-k3nq) | Locations, species labels and trunk-diameter field |
| Sidewalks | [4g86-grxu](https://data.sf.gov/d/4g86-grxu) | Positive actual widths (`SIDEWALK_F`), converted from feet |

Footprints and elevation attributes have older acquisition dates; a recent portal refresh is not a new survey. Ground is an interpolation of footprint ground samples, lightly flattened across roads. No 2023 LiDAR or roof reconstruction is processed yet. Window layouts, facade colours, flat roofs, road widths/markings and tree sizes/shapes are procedural placeholders. The lawn is an explicitly authored approximation. For sidewalks, `SIDEWALK_F` is the actual width; zero/negative entries use defaults. `WIDTH_MIN` and `WIDTH_RECO` are planning recommendations and are not used as measurements. Sidewalk ribbons overlap at junctions; surveyed curb returns, fitted carriageway widths, street furniture and traffic are not implemented. Logical tile groups are not a production streaming/LOD system.

## Next quality milestones

1. Replace interpolated ground with a datum-aligned LiDAR terrain crop and fit road/intersection heights.
2. Resolve street corridors against building fronts; clip sidewalks and model curb returns.
3. Fit a small authored SF facade kit and measured roofs; author the church as a landmark.
4. Replace tree placeholders with a reusable species library and add mapped/inferred street furniture.
5. Bake render LODs, integrate collision/navigation, then measure a fixed route on target browsers.

Keep the semantic IDs and overrides through each upgrade. Geometry is a rebuildable output.
