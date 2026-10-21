import {createHash} from 'node:crypto'
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const uuid = (id) => {
  const h = hash(id)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export function write(path, value) {
  const filename = resolve(root, path)
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'
  if (existsSync(filename) && readFileSync(filename).equals(Buffer.from(bytes))) return false
  mkdirSync(dirname(filename), {recursive: true})
  writeFileSync(filename, bytes)
  return true
}
export const area = read('scene/area.json')
const eastScale = 111320 * Math.cos(area.origin[1] * Math.PI / 180)
export const xy = ([lon, lat]) => [(lon - area.origin[0]) * eastScale, -(lat - area.origin[1]) * 111320]
export const latlon = ([x, z]) => [area.origin[0] + x / eastScale, area.origin[1] - z / 111320]
export const bounds = [...xy([area.bounds[0], area.bounds[3]]), ...xy([area.bounds[2], area.bounds[1]])]
export const inside = ([x, z]) => x >= bounds[0] && x < bounds[2] && z >= bounds[1] && z < bounds[3]
export const number = (value, fallback) => value != null && value !== '' && Number.isFinite(+value) ? +value : fallback
export function polygonArea(ring) {
  return Math.abs(ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length]
    return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)) / 2
}
export function cleanRing(points) {
  let ring = points.map(xy)
  if (Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 0.01) ring.pop()
  for (let round = 0; round < 4 && ring.length > 3; round++) {
    const next = ring.filter((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const d = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.max(length, 0.001)
      return d >= 0.18 || i % 2 === 0
    })
    if (next.length < 3) break
    ring = next
  }
  return ring
}

export function loadCity() {
  const overrides = read('scene/overrides.json')
  if (overrides.version !== 1 || !overrides.features || Array.isArray(overrides.features)) throw new Error('Invalid overrides schema')
  const samples = []
  const buildings = []
  for (const row of read('scene/sources/buildings.json')) {
    const polygons = row.shape.coordinates.map((p) => p.map(cleanRing)).filter((p) => p[0].length >= 3)
    if (!polygons.length) continue
    const outer = polygons[0][0]
    const center = [0, 1].map((axis) => outer.reduce((s, p) => s + p[axis], 0) / outer.length)
    const ground = number(row.gnd_mediancm, NaN) / 100 - area.verticalOriginM
    if (Number.isFinite(ground)) samples.push([...center, ground])
    if (!inside(center) || polygons.reduce((s, p) => s + polygonArea(p[0]), 0) < 20) continue
    const id = `sf-building:${row.sf16_bldgid}`
    const patch = overrides.features[id] || {}
    if (patch.hidden) continue
    const measuredHeight = number(row.hgt_median_m, NaN)
    const height = Math.max(3, Math.min(120, number(patch.heightM, Number.isFinite(measuredHeight) ? measuredHeight : 9)))
    buildings.push({id, sourceId: row.sf16_bldgid, polygons, center, ground,
      height, heightSource: patch.heightM != null ? 'override' : Number.isFinite(measuredHeight) ? 'DataSF hgt_median_m' : 'inferred',
      style: patch.style || 'stucco', facadeColor: patch.facadeColor || null, asset: patch.asset || null,
      sourceDate: row.data_as_of, patch})
  }
  if (!samples.length) throw new Error('No valid ground elevation samples')
  const sidewalk = new Map()
  for (const row of read('scene/sources/sidewalks.json')) {
    // DataSF: SIDEWALK_F is actual width in feet. WIDTH_MIN/RECO are planning recommendations.
    // Negative values mean variable width, and most zeroes are unknown: use the fallback for both.
    const width = number(row.sidewalk_f, 0) * 0.3048
    if (width > 0 && width < 12) {
      const key = String(number(row.cnn, 0))
      sidewalk.set(key, [...(sidewalk.get(key) || []), width])
    }
  }
  const roads = read('scene/sources/roads.json').map((row) => {
    const id = `sf-road:${number(row.cnn, 0)}`, patch = overrides.features[id] || {}
    const walk = sidewalk.get(String(number(row.cnn, 0))) || []
    const alley = ['ALY', 'STWY', 'WALK'].includes(row.st_type)
    const width = number(patch.widthM, alley ? 3.5 : row.streetname?.includes('COLUMBUS') ? 17 : 10)
    return {id, sourceId: row.cnn, name: row.streetname, points: row.line.coordinates.map(xy),
      width, sidewalk: number(patch.sidewalkM, walk.length ? walk.reduce((a, b) => a + b, 0) / walk.length : alley ? 0 : 2.4),
      widthSource: patch.widthM != null ? 'override' : 'class/name heuristic',
      sidewalkSource: patch.sidewalkM != null ? 'override' : walk.length ? 'DataSF SIDEWALK_F actual width (ft converted to m)' : 'inferred',
      oneway: row.oneway, nodes: [row.f_node_cnn, row.t_node_cnn], patch}
  }).filter((r) => !r.patch.hidden)
  const trees = read('scene/sources/trees.json').map((row) => {
    const id = `sf-tree:${row.treeid}`, patch = overrides.features[id] || {}
    const position = xy([number(row.longitude, NaN), number(row.latitude, NaN)])
    const palm = /palm|phoenix|washingtonia/i.test(row.species || '')
    return {id, sourceId: row.treeid, species: row.species || 'Unknown species', position,
      height: number(patch.heightM, Math.max(5, Math.min(15, 5 + number(row.mapdbh, 12) * 0.13))),
      heightSource: patch.heightM != null ? 'override' : 'inferred from trunk diameter; not measured tree height',
      kind: palm ? 'palm' : 'broadleaf', asset: patch.asset || null, patch}
  }).filter((tree) => inside(tree.position) && !tree.patch.hidden)
  const ids = new Set([...buildings, ...roads, ...trees].map((f) => f.id))
  const unmatchedOverrides = Object.keys(overrides.features).filter((id) => !ids.has(id) && !overrides.features[id].hidden)
  return {buildings, roads, trees, samples, unmatchedOverrides}
}

export function elevation(city) {
  const sample = (x, z) => {
    const nearest = city.samples.map((p) => ({d: (p[0] - x) ** 2 + (p[1] - z) ** 2, h: p[2]}))
      .sort((a, b) => a.d - b.d).slice(0, 8)
    let weight = 0, height = 0
    for (const p of nearest) { const w = 1 / (p.d + 36); weight += w; height += p.h * w }
    return height / weight
  }
  const segments = city.roads.flatMap((road) => road.points.slice(1).map((b, i) => {
    const a = road.points[i]
    return {a, b, ha: sample(...a), hb: sample(...b), half: road.width / 2 + road.sidewalk,
      length2: (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2}
  })).filter((s) => s.length2 > 0.01)
  const ground = (x, z) => {
    const base = sample(x, z)
    let target = 0, total = 0, blend = 0
    for (const s of segments) {
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * (s.b[0] - s.a[0]) + (z - s.a[1]) * (s.b[1] - s.a[1])) / s.length2))
      const d = Math.hypot(x - s.a[0] - t * (s.b[0] - s.a[0]), z - s.a[1] - t * (s.b[1] - s.a[1]))
      if (d > s.half + 5) continue
      const w = 1 / (1 + d * d)
      target += (s.ha + t * (s.hb - s.ha)) * w; total += w
      blend = Math.max(blend, 1 - Math.max(0, d - s.half) / 5)
    }
    return total ? base * (1 - blend) + target / total * blend : base
  }
  return {sample, ground}
}
