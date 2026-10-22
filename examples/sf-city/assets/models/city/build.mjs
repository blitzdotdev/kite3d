import {strip, corridors, clipped, crossingLift} from './streets.mjs'
import {THREE, material, surface, asset} from './mesh.mjs'
import {area, bounds, loadCity, elevation, hash, write, xy, polygonArea} from '../../../scene/data.mjs'

const GENERATOR_VERSION = 2
const city = loadCity()
const {ground} = elevation(city)
const roadCorridors = corridors(city.roads)
const outerCorridors = corridors(city.roads.map(r => ({...r, width: r.width + 2 * r.sidewalk})))
const placements = [], collisions = [], tiles = {}
const palette = ['#d5c7aa', '#d7cfbf', '#c1c8bb', '#b8c3ca', '#cfb7aa', '#d6c7ae', '#c4bcae']
const dark = material('Window glass approximation', '#314959', 0.3, 0.25)
const roof = material('Flat roof', '#737670')
const trim = material('Painted trim', '#e2dcd0')
const seed = (id) => parseInt(hash(id).slice(0, 8), 16) / 2 ** 32

function record(feature, generated, position, extra = {}) {
  const tile = extra.tile || `${Math.floor(position[0] / area.tileSizeM)}_${Math.floor(position[2] / area.tileSizeM)}`
  const p = {id: feature.id, sourceId: feature.sourceId, name: feature.name || feature.id,
    asset: feature.asset || generated.path, position, tile, ...extra,
    triangles: generated.triangles || 0, sourceHash: hash(feature)}
  placements.push(p)
  ;(tiles[tile] ||= []).push(feature.id)
}

function building(feature) {
  const [cx, cz] = feature.center
  const groundCorners = feature.polygons.flatMap((p) => p[0].map(([x, z]) => ground(x, z)))
  const base = ground(cx, cz), bottom = Math.min(...groundCorners) - 0.6
  const height = feature.height, floors = Math.max(1, Math.round(height / 3.2))
  const top = base + height
  const color = feature.facadeColor || palette[Math.floor(seed(feature.id) * palette.length)]
  const materials = [material('Inferred stucco facade', color), roof, dark, trim]
  const parts = []
  let polygonIndex = 0
  for (const polygon of feature.polygons) {
    if (polygonArea(polygon[0]) < 2) continue
    const shape = new THREE.Shape(polygon[0].map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz))))
    for (const hole of polygon.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)))))
    const body = new THREE.ExtrudeGeometry(shape, {depth: top - bottom, bevelEnabled: false, steps: 1, curveSegments: 1})
    body.rotateX(-Math.PI / 2); body.translate(0, bottom - base, 0)
    parts.push({name: `Footprint ${polygonIndex++}`, geometry: body, mat: [1, 0]})
    const windows = [], indices = [], trimPoints = [], trimIndices = []
    const signed = polygon[0].reduce((s, a, i) => {const b = polygon[0][(i + 1) % polygon[0].length]; return s + a[0] * b[1] - b[0] * a[1]}, 0)
    for (let i = 0; i < polygon[0].length; i++) {
      const a = polygon[0][i], b = polygon[0][(i + 1) % polygon[0].length]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 2.4) continue
      const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length
      const sign = Math.sign(signed), nx = uz * sign, nz = -ux * sign
      const bays = Math.floor(length / 2.8)
      for (let f = 0; f < floors; f++) {
        const y = f * height / floors + 0.9
        const windowH = Math.min(1.65, height / floors - 1.1)
        if (windowH <= 0) continue
        for (let k = 0; k < bays; k++) {
          const s = length * (k + 0.5) / bays, half = Math.min(0.62, length / bays * 0.23)
          const x = a[0] + ux * s - cx + nx * 0.055, z = a[1] + uz * s - cz + nz * 0.055
          const v = windows.length
          windows.push([x - ux * half, y, z - uz * half], [x + ux * half, y, z + uz * half],
            [x + ux * half, y + windowH, z + uz * half], [x - ux * half, y + windowH, z - uz * half])
          indices.push([v, v + 1, v + 2], [v, v + 2, v + 3])
          const t = trimPoints.length, hw = half + 0.1
          trimPoints.push([x - ux * hw, y - 0.1, z - uz * hw], [x + ux * hw, y - 0.1, z + uz * hw],
            [x + ux * hw, y - 0.1, z + uz * hw], [x - ux * hw, y - 0.1, z - uz * hw])
          // A real sill with depth, rather than an extra coplanar facade sheet.
          trimPoints[t + 2][0] += nx * 0.18; trimPoints[t + 2][2] += nz * 0.18
          trimPoints[t + 3][0] += nx * 0.18; trimPoints[t + 3][2] += nz * 0.18
          trimIndices.push([t, t + 1, t + 2], [t, t + 2, t + 3])
        }
      }
    }
    if (windows.length) parts.push({name: 'Inferred window bays', geometry: surface(windows, indices), mat: 2})
    if (trimPoints.length) parts.push({name: 'Window sills', geometry: surface(trimPoints, trimIndices), mat: 3})
  }
  const id = feature.id.replace(':', '-')
  const generated = asset(`assets/models/city/buildings/${id}`, parts, materials,
    {name: `Building ${feature.sourceId}`, cityId: feature.id, heightSource: feature.heightSource})
  record({...feature, name: `Building ${feature.sourceId}`}, generated, [cx, base, cz],
    {kind: 'building', heightM: height, heightSource: feature.heightSource, facadeSource: 'procedural placeholder',
      sourceDataset: 'ynuv-fyni'})
  collisions.push({id: feature.id, polygons: feature.polygons, bottomM: bottom, topM: top,
    type: 'footprint-prism', integratedPhysics: false})
}

function clip(a, b) {
  let low = 0, high = 1
  const dx = b[0] - a[0], dz = b[1] - a[1]
  for (const [p, q] of [[-dx, a[0] - bounds[0]], [dx, bounds[2] - a[0]], [-dz, a[1] - bounds[1]], [dz, bounds[3] - a[1]]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t)
    if (low > high) return null
  }
  return [[a[0] + low * dx, a[1] + low * dz], [a[0] + high * dx, a[1] + high * dz]]
}

function road(feature) {
  const points = [], triangles = [], walks = [], wt = [], paint = [], pt = [], curbs = [], ct = [], gutters = [], gt = []
  let asphaltMasks = []
  const strips = (target, tris, a, b, left, right, lift, step = 1) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.01) return
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len
    const count = Math.ceil(len / step)
    for (let k = 0; k < count; k++) {
      const polygon = [[k / count, left], [k / count, right], [(k + 1) / count, right], [(k + 1) / count, left]]
        .map(([t, off]) => [a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + nz * off])
      for (const part of target === points ? clipped(polygon, asphaltMasks) : [polygon]) {
        const v = target.length
        part.forEach(([x, z]) => target.push([x, ground(x, z) + lift, z]))
        for (let j = 1; j + 1 < part.length; j++) tris.push([v, v + j, v + j + 1])
      }
    }
  }
  const half = feature.width / 2
  for (let i = 1; i < feature.points.length; i++) {
    const pair = clip(feature.points[i - 1], feature.points[i])
    if (!pair) continue
    const [a, b] = pair, len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const corridorIndex = roadCorridors.findIndex(s => s.id === feature.id && s.index === i - 1)
    asphaltMasks = roadCorridors.slice(0, corridorIndex)
    strips(points, triangles, a, b, -half, half, 0.07)
    const masks = roadCorridors.filter(s => s.id !== feature.id || s.index !== i - 1)
    const count = Math.ceil(len)
    const interpolate = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (feature.sidewalk > 0) {
      for (let k = 0; k < count; k++) {
        const start = interpolate(k / count), end = interpolate((k + 1) / count)
        for (const [left, right] of [[-half - feature.sidewalk, -half], [half, half + feature.sidewalk]]) {
          for (const polygon of clipped(strip(start, end, left, right), [...masks, ...outerCorridors.slice(0, corridorIndex)])) {
            const v = walks.length
            polygon.forEach(p => walks.push([p[0], ground(...p) + crossingLift(p, masks), p[1]]))
            for (let j = 1; j + 1 < polygon.length; j++) wt.push([v, v + j, v + j + 1])
            for (let j = 0; j < polygon.length; j++) {
              const p = polygon[j], q = polygon[(j + 1) % polygon.length]
              const offset = r => Math.abs(((b[0] - a[0]) * (r[1] - a[1]) - (b[1] - a[1]) * (r[0] - a[0])) / len)
              // Only the carriageway-facing edge gets a curb; cell seams stay open.
              if (Math.abs(offset(p) - half) > 1e-5 || Math.abs(offset(q) - half) > 1e-5) continue
              const c = curbs.length
              curbs.push([p[0], ground(...p) + 0.07, p[1]], [q[0], ground(...q) + 0.07, q[1]],
                [q[0], ground(...q) + crossingLift(q, masks), q[1]], [p[0], ground(...p) + crossingLift(p, masks), p[1]])
              ct.push([c, c + 1, c + 2], [c, c + 2, c + 3])
            }
          }
        }
        for (const [left, right] of [[-half, -half + 0.3], [half - 0.3, half]]) {
          for (const polygon of clipped(strip(start, end, left, right), masks)) {
            const v = gutters.length
            polygon.forEach(p => gutters.push([p[0], ground(...p) + 0.075, p[1]]))
            for (let j = 1; j + 1 < polygon.length; j++) gt.push([v, v + j, v + j + 1])
          }
        }
      }
    }
    if (feature.width >= 8) {
      for (let s = 9; s + 3 < len - 9; s += 8) {
        const p = [a[0] + (b[0] - a[0]) * s / len, a[1] + (b[1] - a[1]) * s / len]
        const q = [a[0] + (b[0] - a[0]) * (s + 3) / len, a[1] + (b[1] - a[1]) * (s + 3) / len]
        strips(paint, pt, p, q, -0.065, 0.065, 0.09)
      }
    }
  }
  if (!points.length) return
  const parts = [{name: 'Carriageway', geometry: surface(points, triangles), mat: 0}]
  if (walks.length) parts.push({name: 'Clipped sidewalks with lowered crossing approaches', geometry: surface(walks, wt), mat: 1})
  if (curbs.length) parts.push({name: 'Raised curb faces', geometry: surface(curbs, ct), mat: 1})
  if (gutters.length) parts.push({name: 'Concrete drainage margins', geometry: surface(gutters, gt), mat: 1})
  if (paint.length) parts.push({name: 'Inferred center markings', geometry: surface(paint, pt), mat: 2})
  const generated = asset(`assets/models/city/roads/${feature.id.replace(':', '-')}`, parts,
    [material('Asphalt', '#555a5d'), material('Concrete sidewalk', '#bcb9ac'), material('Centerline', '#e4c76a')],
    {name: feature.name, cityId: feature.id})
  const center = feature.points[Math.floor(feature.points.length / 2)]
  record(feature, generated, [0, 0, 0], {kind: 'road', tile: `${Math.floor(center[0] / area.tileSizeM)}_${Math.floor(center[1] / area.tileSizeM)}`,
    widthM: feature.width, widthSource: feature.widthSource, sidewalkSource: feature.sidewalkSource, sourceDataset: '3psu-pn9h'})
}

function trees() {
  const leaves = [material('Broadleaf canopy', '#667954'), material('Trunk', '#79634c')]
  const broadleaf = asset('assets/models/city/trees/broadleaf', [
    {name: 'Trunk', geometry: new THREE.CylinderGeometry(0.16, 0.24, 4.7, 7).translate(0, 2.35, 0), mat: 1},
    {name: 'Canopy', geometry: new THREE.IcosahedronGeometry(3.2, 1).scale(1, 1.1, 1).translate(0, 6.5, 0), mat: 0},
  ], leaves, {name: 'Broadleaf placeholder, 10 m'})
  const palmParts = [{name: 'Trunk', geometry: new THREE.CylinderGeometry(0.16, 0.28, 8.6, 7).translate(0, 4.3, 0), mat: 1}]
  for (let k = 0; k < 8; k++) {
    const angle = k * Math.PI / 4
    palmParts.push({name: `Palm frond ${k + 1}`, mat: 0,
      geometry: surface([[0, 9.7, 0], [Math.cos(angle + 0.3) * 1.7, 10, Math.sin(angle + 0.3) * 1.7],
        [Math.cos(angle) * 3.5, 8.6, Math.sin(angle) * 3.5], [Math.cos(angle - 0.3) * 1.7, 10, Math.sin(angle - 0.3) * 1.7]], [[0, 1, 2], [0, 2, 3]])})
  }
  const palm = asset('assets/models/city/trees/palm', palmParts, leaves, {name: 'Palm placeholder, 10 m'})
  for (const tree of city.trees) {
    const [x, z] = tree.position
    record({...tree, name: `${tree.species.split(' :: ')[0]} #${tree.sourceId}`}, tree.kind === 'palm' ? palm : broadleaf,
      [x, ground(x, z), z], {kind: 'tree', heightM: tree.height, heightSource: tree.heightSource, species: tree.species,
        scale: [tree.height / 10, tree.height / 10, tree.height / 10], yaw: seed(tree.id) * Math.PI * 2,
        sourceDataset: 'tkzw-k3nq'})
  }
}

function terrain() {
  // Authored approximation from the bounding street centerlines, inset for sidewalks.
  // This is not a surveyed park boundary or a claim about present landscaping.
  const park = [[-122.410206544, 37.800315499], [-122.409189818, 37.800445061], [-122.409369117, 37.801370656],
    [-122.411018517, 37.801169752], [-122.41095374, 37.800832982]].map(xy)
  const pc = [0, 1].map((i) => park.reduce((s, p) => s + p[i], 0) / park.length)
  for (const p of park) {const d = Math.hypot(p[0] - pc[0], p[1] - pc[1]); p[0] += (pc[0] - p[0]) * 11 / d; p[1] += (pc[1] - p[1]) * 11 / d}
  function inPark(x, z) {
    let inside = false
    for (let i = 0, j = park.length - 1; i < park.length; j = i++) {
      const a = park[i], b = park[j]
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
    }
    return inside
  }
  const positions = [], paved = [], grass = [], grid = []
  const countX = Math.ceil((bounds[2] - bounds[0] + 30) / area.terrainStepM)
  const countZ = Math.ceil((bounds[3] - bounds[1] + 30) / area.terrainStepM)
  for (let j = 0; j <= countZ; j++) {
    grid[j] = []
    for (let i = 0; i <= countX; i++) {
      const x = bounds[0] - 15 + i * (bounds[2] - bounds[0] + 30) / countX
      const z = bounds[1] - 15 + j * (bounds[3] - bounds[1] + 30) / countZ
      grid[j][i] = positions.length; positions.push([x, ground(x, z), z])
      if (i && j) {
        const previous = positions[grid[j - 1][i - 1]]
        const list = inPark((x + previous[0]) / 2, (z + previous[2]) / 2) ? grass : paved
        list.push([grid[j - 1][i - 1], grid[j][i], grid[j - 1][i]], [grid[j - 1][i - 1], grid[j][i - 1], grid[j][i]])
      }
    }
  }
  // The coarse terrain must not poke through finely graded roads on hills.
  // Remove covered ground triangles rather than hiding the mismatch with a vertical offset.
  const groundMasks = outerCorridors
  const visibleGround = [], visiblePaved = [], visibleGrass = []
  for (const [source, target] of [[paved, visiblePaved], [grass, visibleGrass]]) {
    for (const triangle of source) {
      const footprint = triangle.map(i => [positions[i][0], positions[i][2]])
      for (const polygon of clipped(footprint, groundMasks)) {
        const v = visibleGround.length
        polygon.forEach(p => visibleGround.push([p[0], ground(...p), p[1]]))
        for (let j = 1; j + 1 < polygon.length; j++) target.push([v, v + j, v + j + 1])
      }
    }
  }
  const generated = asset('assets/models/city/terrain', [
    {name: 'Interpolated ground', geometry: surface(visibleGround, visiblePaved), mat: 0},
    {name: 'Approximate Washington Square lawn', geometry: surface(visibleGround, visibleGrass), mat: 1},
  ], [material('Urban ground', '#a8a397'), material('Lawn', '#83906a')],
  {name: 'Ground from footprint ground samples', elevationSource: 'Interpolated DataSF gnd_mediancm; NAVD88 metres; not 2023 LiDAR'})
  record({id: 'sf-terrain:north-beach', name: 'North Beach ground'}, generated, [0, 0, 0], {kind: 'terrain'})
  write('scene/collision.json', {version: 1, origin: area.origin, verticalOriginM: area.verticalOriginM,
    integratedPhysics: false, terrain: {positions, triangles: [...paved, ...grass]}, buildings: collisions})
}

for (const feature of city.buildings) building(feature)
for (const feature of city.roads) road(feature)
trees(); terrain()
const provenance = JSON.parse((await import('node:fs')).readFileSync(new URL('../../../scene/sources/provenance.json', import.meta.url), 'utf8'))
write('scene/generated.json', {version: 1, generatorVersion: GENERATOR_VERSION, area, provenance,
  assumptions: ['Ground interpolated from older city footprint ground elevations; no 2023 LiDAR processed.',
    'Facades, flat roofs, road widths, markings and tree sizes are inferred placeholders.',
    'Sidewalk widths use positive SIDEWALK_F observations from the 2014 study, with defaults for unknown/variable widths; not surveyed curb geometry.',
    'Sidewalks are clipped against carriageways; 15 cm curbs and 1.8 m lowered crossing approaches are heuristic, not surveyed or accessibility-certified.',
    'Park lawn is an authored approximation. No traffic simulation, street furniture or physics integration yet.',
    'Tiles are logical ownership groups; production streaming and LOD generation are not implemented.'],
  unmatchedOverrides: city.unmatchedOverrides, tiles, placements,
  stats: {buildings: city.buildings.length, roads: city.roads.length, trees: city.trees.length,
    tiles: Object.keys(tiles).length, triangles: placements.reduce((s, p) => s + p.triangles, 0)}})
console.log(`Baked ${city.buildings.length} buildings, ${city.roads.length} roads and ${city.trees.length} trees`)
