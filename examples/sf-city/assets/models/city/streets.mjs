// Offline convex corridor clipping in local metres. Curb shapes are heuristic, not surveyed.
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
export function strip(a, b, left, right) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / length, nz = (b[0] - a[0]) / length
  return [[a[0] + nx * left, a[1] + nz * left], [b[0] + nx * left, b[1] + nz * left],
    [b[0] + nx * right, b[1] + nz * right], [a[0] + nx * right, a[1] + nz * right]]
}
function halfPlane(polygon, a, b, sign) {
  const out = []
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length]
    const dp = cross(a, b, p) * sign, dq = cross(a, b, q) * sign
    if (dp >= 0) out.push(p)
    if ((dp < 0) !== (dq < 0)) {
      const t = dp / (dp - dq)
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return out
}
function subtract(subject, mask) {
  let inside = subject
  const outside = []
  for (let i = 0; i < mask.length && inside.length >= 3; i++) {
    const a = mask[i], b = mask[(i + 1) % mask.length]
    const piece = halfPlane(inside, a, b, -1)
    if (piece.length >= 3) outside.push(piece)
    inside = halfPlane(inside, a, b, 1)
  }
  return outside
}
const bbox = p => [Math.min(...p.map(v => v[0])), Math.min(...p.map(v => v[1])), Math.max(...p.map(v => v[0])), Math.max(...p.map(v => v[1]))]
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
export function corridors(roads) {
  return roads.flatMap(road => road.points.slice(1).flatMap((b, i) => {
    const a = road.points[i]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) return []
    const polygon = strip(a, b, -road.width / 2, road.width / 2)
    return [{id: road.id, index: i, a, b, half: road.width / 2, polygon, box: bbox(polygon)}]
  }))
}
export function clipped(polygon, masks) {
  let pieces = [polygon]
  const box = bbox(polygon)
  for (const mask of masks) {
    if (overlaps(box, mask.box)) pieces = pieces.flatMap(piece => subtract(piece, mask.polygon))
  }
  return pieces.filter(p => Math.abs(p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)) > 1e-7)
}
export function crossingLift(p, masks) {
  let nearest = Infinity
  for (const s of masks) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], length = Math.hypot(dx, dz)
    const along = ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dz) / length
    const across = Math.abs(((p[0] - s.a[0]) * dz - (p[1] - s.a[1]) * dx) / length)
    nearest = Math.min(nearest, Math.hypot(Math.max(0, -along, along - length), Math.max(0, across - s.half)))
  }
  return 0.07 + 0.15 * Math.min(1, nearest / 1.8)
}
